import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import bcrypt from "bcryptjs";
import {
  createTaskRequestSchema,
  submitProofRequestSchema,
  TaskStatus,
  SubmissionStatus,
  PaymentStatus,
} from "@shared/schema";
import { verifySubmission, generateTasks, analyzeBudget } from "./services/claude";
import { sendPayment, getBalance, isValidWalletAddress, getEmployerAddress, getConnectionInfo, verifyTransaction } from "./services/solana";
import { getCreatorRewards, claimCreatorRewards, checkPumpPortalHealth } from "./services/pumpportal";
import rateLimit from 'express-rate-limit';

// Maximum payment amount per transaction (in SOL)
const MAX_PAYMENT_AMOUNT_SOL = 10;

// Admin API key authentication middleware
function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"] || req.headers["authorization"]?.replace("Bearer ", "");
  const adminKey = process.env.ADMIN_API_KEY;

  if (!adminKey) {
    console.warn("ADMIN_API_KEY not set - admin endpoints are disabled");
    return res.status(503).json({ error: "Admin API not configured" });
  }

  if (apiKey !== adminKey) {
    return res.status(401).json({ error: "Unauthorized - invalid API key" });
  }

  next();
}

// Worker authentication middleware (basic check)
function requireWorkerAuth(req: Request, res: Response, next: NextFunction) {
  const workerId = req.body.workerId || req.params.workerId;
  if (!workerId) {
    return res.status(400).json({ error: "Worker ID required" });
  }
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ============== Health & Status ==============

  app.get("/api/health", async (_req: Request, res: Response) => {
    const employerAddress = getEmployerAddress();
    const connectionInfo = getConnectionInfo();
    const pumpPortalHealthy = await checkPumpPortalHealth();

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        claude: !!process.env.ANTHROPIC_API_KEY,
        solana: {
          configured: !!process.env.EMPLOYER_WALLET_PRIVATE_KEY,
          employerAddress,
          network: connectionInfo.network,
        },
        pumpPortal: pumpPortalHealthy,
        adminApi: !!process.env.ADMIN_API_KEY,
      },
    });
  });

  // Limit admin API calls to 5 requests per minute per IP
const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: {
    error: 'Too many admin requests, please try again later.'
  },
});


  // ============== Users/Workers ==============

  app.post("/api/users", async (req: Request, res: Response) => {
    try {
      const { username, password, walletAddress } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      if (walletAddress && !isValidWalletAddress(walletAddress)) {
        return res.status(400).json({ error: "Invalid wallet address" });
      }

      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ error: "Username already exists" });
      }

      // Hash password before storing
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username, password: hashedPassword, walletAddress });

      // Never return password hash
      res.status(201).json({
        id: user.id,
        username: user.username,
        walletAddress: user.walletAddress,
      });
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  // Worker login
  app.post("/api/users/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Return user data without password
      res.json({
        id: user.id,
        username: user.username,
        walletAddress: user.walletAddress,
        totalEarnings: user.totalEarnings,
        tasksCompleted: user.tasksCompleted,
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.get("/api/users/:id", async (req: Request, res: Response) => {
    const user = await storage.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    // Never return password
    res.json({
      id: user.id,
      username: user.username,
      walletAddress: user.walletAddress,
      totalEarnings: user.totalEarnings,
      tasksCompleted: user.tasksCompleted,
    });
  });

  app.get("/api/users/:id/submissions", async (req: Request, res: Response) => {
    const submissions = await storage.getSubmissionsByWorker(req.params.id);
    res.json(submissions);
  });

  app.get("/api/users/:id/payments", async (req: Request, res: Response) => {
    const payments = await storage.getPaymentsByWorker(req.params.id);
    res.json(payments);
  });

  // ============== Tasks ==============

  app.get("/api/tasks", async (_req: Request, res: Response) => {
    const tasks = await storage.getAllTasks();
    res.json(tasks);
  });

  app.get("/api/tasks/open", async (_req: Request, res: Response) => {
    const tasks = await storage.getOpenTasks();
    res.json(tasks);
  });

  app.get("/api/tasks/:id", async (req: Request, res: Response) => {
    const task = await storage.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }
    res.json(task);
  });

  app.get("/api/tasks/:id/submissions", async (req: Request, res: Response) => {
    const submissions = await storage.getSubmissionsByTask(req.params.id);
    res.json(submissions);
  });

  // Create task - Admin only (Claude as employer)
  app.post("/api/tasks", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const parsed = createTaskRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors });
      }

      // Validate reward amount
      const rewardAmount = parseFloat(parsed.data.rewardSol);
      if (rewardAmount > MAX_PAYMENT_AMOUNT_SOL) {
        return res.status(400).json({
          error: `Reward exceeds maximum allowed (${MAX_PAYMENT_AMOUNT_SOL} SOL)`,
        });
      }

      const task = await storage.createTask({
        title: parsed.data.title,
        description: parsed.data.description,
        taskType: parsed.data.taskType,
        rewardSol: parsed.data.rewardSol,
        verificationCriteria: parsed.data.verificationCriteria,
        maxSubmissions: parsed.data.maxSubmissions,
        deadline: parsed.data.deadline,
      });

      res.status(201).json(task);
    } catch (error) {
      console.error("Create task error:", error);
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  // AI generates tasks based on project context - Admin only
  app.post("/api/tasks/generate", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { projectContext, budgetSol, taskCount } = req.body;

      if (!projectContext || !budgetSol) {
        return res.status(400).json({ error: "projectContext and budgetSol required" });
      }

      const budget = parseFloat(budgetSol);
      if (isNaN(budget) || budget <= 0) {
        return res.status(400).json({ error: "Invalid budget amount" });
      }

      const generatedTasks = await generateTasks(
        projectContext,
        budget,
        taskCount || 5
      );

      if (generatedTasks.length === 0) {
        return res.status(500).json({
          error: "Failed to generate tasks - check ANTHROPIC_API_KEY",
        });
      }

      // Create tasks in storage with validation
      const createdTasks = [];
      for (const taskData of generatedTasks) {
        const reward = parseFloat(taskData.rewardSol);
        if (isNaN(reward) || reward <= 0 || reward > MAX_PAYMENT_AMOUNT_SOL) {
          continue; // Skip invalid tasks
        }

        const task = await storage.createTask({
          title: taskData.title,
          description: taskData.description,
          taskType: taskData.taskType as "code" | "social" | "marketing" | "design" | "other",
          rewardSol: taskData.rewardSol,
          verificationCriteria: taskData.verificationCriteria,
          maxSubmissions: 1,
          deadline: undefined,
        });
        createdTasks.push(task);
      }

      res.status(201).json({ generated: createdTasks.length, tasks: createdTasks });
    } catch (error) {
      console.error("Generate tasks error:", error);
      res.status(500).json({ error: "Failed to generate tasks" });
    }
  });

  // Claim/assign task to worker
  app.post("/api/tasks/:id/claim", async (req: Request, res: Response) => {
    try {
      const { workerId } = req.body;
      if (!workerId) {
        return res.status(400).json({ error: "workerId required" });
      }

      // Verify worker exists
      const worker = await storage.getUser(workerId);
      if (!worker) {
        return res.status(404).json({ error: "Worker not found" });
      }

      const task = await storage.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }

      if (task.status !== TaskStatus.OPEN) {
        return res.status(400).json({ error: "Task is not open for claiming" });
      }

      await storage.assignTask(req.params.id, workerId);
      const updatedTask = await storage.getTask(req.params.id);

      res.json(updatedTask);
    } catch (error) {
      console.error("Claim task error:", error);
      res.status(500).json({ error: "Failed to claim task" });
    }
  });

  // ============== Submissions ==============

  app.post("/api/submissions", async (req: Request, res: Response) => {
    try {
      const parsed = submitProofRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors });
      }

      // Verify worker exists
      const worker = await storage.getUser(parsed.data.workerId);
      if (!worker) {
        return res.status(404).json({ error: "Worker not found" });
      }

      const task = await storage.getTask(parsed.data.taskId);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }

      if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
        return res.status(400).json({ error: "Task is closed" });
      }

      // Check if max submissions reached
      if (task.maxSubmissions && (task.currentSubmissions || 0) >= task.maxSubmissions) {
        return res.status(400).json({ error: "Maximum submissions reached for this task" });
      }

      const submission = await storage.createSubmission({
        taskId: parsed.data.taskId,
        workerId: parsed.data.workerId,
        proofType: parsed.data.proofType,
        proofData: parsed.data.proofData,
        proofDescription: parsed.data.proofDescription,
      });

      await storage.incrementTaskSubmissions(task.id);

      res.status(201).json(submission);
    } catch (error) {
      console.error("Create submission error:", error);
      res.status(500).json({ error: "Failed to create submission" });
    }
  });

  app.get("/api/submissions/:id", async (req: Request, res: Response) => {
    const submission = await storage.getSubmission(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    res.json(submission);
  });

  app.get("/api/submissions/pending", requireAdminAuth, async (_req: Request, res: Response) => {
    const submissions = await storage.getPendingSubmissions();
    res.json(submissions);
  });

  // ============== Verification - Admin Only ==============

  // Verify a submission using Claude
  app.post("/api/submissions/:id/verify", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const submission = await storage.getSubmission(req.params.id);
      if (!submission) {
        return res.status(404).json({ error: "Submission not found" });
      }

      if (submission.status !== SubmissionStatus.PENDING) {
        return res.status(400).json({ error: "Submission already verified" });
      }

      const task = await storage.getTask(submission.taskId);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }

      // Call Claude for verification
      const result = await verifySubmission(
        task,
        submission.proofType,
        submission.proofData,
        submission.proofDescription || undefined
      );

      // Check if verification actually succeeded (not just returned false)
      if (result.reasoning.startsWith("Verification failed:")) {
        return res.status(500).json({
          error: "Verification service error",
          details: result.reasoning,
        });
      }

      // Update submission status
      const newStatus = result.approved ? SubmissionStatus.APPROVED : SubmissionStatus.REJECTED;
      await storage.updateSubmissionStatus(
        submission.id,
        newStatus,
        result.reasoning,
        result.score.toString()
      );

      // If approved, create payment
      if (result.approved) {
        const worker = await storage.getUser(submission.workerId);
        if (worker?.walletAddress) {
          await storage.createPayment({
            submissionId: submission.id,
            taskId: task.id,
            workerId: submission.workerId,
            walletAddress: worker.walletAddress,
            amountSol: task.rewardSol,
          });
        }

        // Update task status
        await storage.updateTaskStatus(task.id, TaskStatus.COMPLETED);
      }

      const updatedSubmission = await storage.getSubmission(submission.id);

      res.json({
        submission: updatedSubmission,
        verification: result,
      });
    } catch (error) {
      console.error("Verification error:", error);
      res.status(500).json({ error: "Verification failed" });
    }
  });

  // Batch verify all pending submissions - Admin only
  app.post("/api/verify/batch", requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const pendingSubmissions = await storage.getPendingSubmissions();
      const results = [];

      for (const submission of pendingSubmissions) {
        const task = await storage.getTask(submission.taskId);
        if (!task) continue;

        const result = await verifySubmission(
          task,
          submission.proofType,
          submission.proofData,
          submission.proofDescription || undefined
        );

        // Skip if verification service failed
        if (result.reasoning.startsWith("Verification failed:")) {
          results.push({
            submissionId: submission.id,
            error: "Verification service error",
          });
          continue;
        }

        const newStatus = result.approved ? SubmissionStatus.APPROVED : SubmissionStatus.REJECTED;
        await storage.updateSubmissionStatus(
          submission.id,
          newStatus,
          result.reasoning,
          result.score.toString()
        );

        if (result.approved) {
          const worker = await storage.getUser(submission.workerId);
          if (worker?.walletAddress) {
            await storage.createPayment({
              submissionId: submission.id,
              taskId: task.id,
              workerId: submission.workerId,
              walletAddress: worker.walletAddress,
              amountSol: task.rewardSol,
            });
          }
          await storage.updateTaskStatus(task.id, TaskStatus.COMPLETED);
        }

        results.push({
          submissionId: submission.id,
          approved: result.approved,
          score: result.score,
        });
      }

      res.json({ processed: results.length, results });
    } catch (error) {
      console.error("Batch verification error:", error);
      res.status(500).json({ error: "Batch verification failed" });
    }
  });

  // ============== Payments - Admin Only ==============

  app.get("/api/payments", requireAdminAuth, async (_req: Request, res: Response) => {
    const payments = await storage.getPendingPayments();
    res.json(payments);
  });

  app.get("/api/payments/:id", requireAdminAuth, async (req: Request, res: Response) => {
    const payment = await storage.getPayment(req.params.id);
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }
    res.json(payment);
  });

  // Process a pending payment - Admin only
  app.post("/api/payments/:id/process", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const payment = await storage.getPayment(req.params.id);
      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }

      if (payment.status !== PaymentStatus.PENDING) {
        return res.status(400).json({ error: "Payment already processed" });
      }

      const amount = parseFloat(payment.amountSol);

      // Validate payment amount
      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: "Invalid payment amount" });
      }

      if (amount > MAX_PAYMENT_AMOUNT_SOL) {
        return res.status(400).json({
          error: `Payment amount exceeds maximum (${MAX_PAYMENT_AMOUNT_SOL} SOL)`,
        });
      }

      // Validate wallet address
      if (!isValidWalletAddress(payment.walletAddress)) {
        await storage.updatePaymentStatus(
          payment.id,
          PaymentStatus.FAILED,
          undefined,
          "Invalid wallet address"
        );
        return res.status(400).json({ error: "Invalid wallet address" });
      }

      // Update to processing
      await storage.updatePaymentStatus(payment.id, PaymentStatus.PROCESSING);

      // Send SOL transaction
      const result = await sendPayment(payment.walletAddress, amount);

      if (result.success && result.signature) {
        // Verify transaction was confirmed
        const txVerification = await verifyTransaction(result.signature);
        if (!txVerification.confirmed) {
          await storage.updatePaymentStatus(
            payment.id,
            PaymentStatus.FAILED,
            undefined,
            "Transaction not confirmed"
          );
          return res.status(500).json({ error: "Transaction not confirmed" });
        }

        await storage.updatePaymentStatus(
          payment.id,
          PaymentStatus.COMPLETED,
          result.signature
        );
        await storage.updateUserEarnings(payment.workerId, payment.amountSol);
        await storage.addToPaidOut(payment.amountSol);

        res.json({
          success: true,
          signature: result.signature,
          payment: await storage.getPayment(payment.id),
        });
      } else {
        await storage.updatePaymentStatus(
          payment.id,
          PaymentStatus.FAILED,
          undefined,
          result.error
        );

        res.status(500).json({
          success: false,
          error: result.error,
          payment: await storage.getPayment(payment.id),
        });
      }
    } catch (error) {
      console.error("Process payment error:", error);
      res.status(500).json({ error: "Payment processing failed" });
    }
  });

  // Process all pending payments - Admin only
  app.post("/api/payments/process-all", requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const pendingPayments = await storage.getPendingPayments();
      const results = [];

      for (const payment of pendingPayments) {
        const amount = parseFloat(payment.amountSol);

        // Skip invalid payments
        if (isNaN(amount) || amount <= 0 || amount > MAX_PAYMENT_AMOUNT_SOL) {
          await storage.updatePaymentStatus(
            payment.id,
            PaymentStatus.FAILED,
            undefined,
            "Invalid payment amount"
          );
          results.push({
            paymentId: payment.id,
            success: false,
            error: "Invalid payment amount",
          });
          continue;
        }

        if (!isValidWalletAddress(payment.walletAddress)) {
          await storage.updatePaymentStatus(
            payment.id,
            PaymentStatus.FAILED,
            undefined,
            "Invalid wallet address"
          );
          results.push({
            paymentId: payment.id,
            success: false,
            error: "Invalid wallet address",
          });
          continue;
        }

        await storage.updatePaymentStatus(payment.id, PaymentStatus.PROCESSING);

        const result = await sendPayment(payment.walletAddress, amount);

        if (result.success && result.signature) {
          await storage.updatePaymentStatus(
            payment.id,
            PaymentStatus.COMPLETED,
            result.signature
          );
          await storage.updateUserEarnings(payment.workerId, payment.amountSol);
          await storage.addToPaidOut(payment.amountSol);
        } else {
          await storage.updatePaymentStatus(
            payment.id,
            PaymentStatus.FAILED,
            undefined,
            result.error
          );
        }

        results.push({
          paymentId: payment.id,
          success: result.success,
          signature: result.signature,
          error: result.error,
        });
      }

      res.json({ processed: results.length, results });
    } catch (error) {
      console.error("Process all payments error:", error);
      res.status(500).json({ error: "Batch payment processing failed" });
    }
  });

  // Verify a transaction - Public endpoint
  app.get("/api/payments/verify/:signature", async (req: Request, res: Response) => {
    try {
      const result = await verifyTransaction(req.params.signature);
      res.json(result);
    } catch (error) {
      console.error("Verify transaction error:", error);
      res.status(500).json({ error: "Failed to verify transaction" });
    }
  });

  // ============== Budget / Creator Rewards - Admin Only ==============

  app.get("/api/budget", requireAdminAuth, async (_req: Request, res: Response) => {
    const budget = await storage.getBudget();
    const employerAddress = getEmployerAddress();
    let solanaBalance = 0;

    if (employerAddress) {
      solanaBalance = await getBalance(employerAddress);
    }

    res.json({
      budget,
      solanaBalance,
      employerAddress,
    });
  });

  app.get("/api/budget/creator-rewards", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const walletAddress = req.query.wallet as string || getEmployerAddress();
      if (!walletAddress) {
        return res.status(400).json({ error: "Wallet address required" });
      }

      if (!isValidWalletAddress(walletAddress)) {
        return res.status(400).json({ error: "Invalid wallet address" });
      }

      const rewards = await getCreatorRewards(walletAddress);
      res.json(rewards);
    } catch (error) {
      console.error("Get creator rewards error:", error);
      res.status(500).json({ error: "Failed to get creator rewards" });
    }
  });

  app.post("/api/budget/claim-rewards", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const walletAddress = req.body.wallet || getEmployerAddress();
      if (!walletAddress) {
        return res.status(400).json({ error: "Wallet address required" });
      }

      if (!isValidWalletAddress(walletAddress)) {
        return res.status(400).json({ error: "Invalid wallet address" });
      }

      const result = await claimCreatorRewards(walletAddress);

      if (result.success && result.amountClaimed) {
        // Get current balance and add claimed amount
        const currentBudget = await storage.getBudget();
        const currentBalance = parseFloat(currentBudget?.balanceSol || "0");
        const newBalance = currentBalance + result.amountClaimed;
        await storage.updateBudget(newBalance.toString(), walletAddress);
      }

      res.json(result);
    } catch (error) {
      console.error("Claim rewards error:", error);
      res.status(500).json({ error: "Failed to claim rewards" });
    }
  });

  app.get("/api/budget/analyze", requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const budget = await storage.getBudget();
      const pendingPayments = await storage.getPendingPayments();
      const allTasks = await storage.getAllTasks();
      const completedTasks = allTasks.filter((t) => t.status === TaskStatus.COMPLETED);

      const pendingTotal = pendingPayments.reduce(
        (sum, p) => sum + parseFloat(p.amountSol),
        0
      );

      const analysis = await analyzeBudget(
        parseFloat(budget?.balanceSol || "0"),
        pendingTotal,
        completedTasks.length
      );

      res.json(analysis);
    } catch (error) {
      console.error("Budget analysis error:", error);
      res.status(500).json({ error: "Failed to analyze budget" });
    }
  });

  app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/tasks') || req.path.startsWith('/submissions') || req.path.startsWith('/payments') || req.path.startsWith('/budget')) {
    return adminLimiter(req, res, next);
  }
  next();
});


  // ============== Stats - Public ==============

  app.get("/api/stats", async (_req: Request, res: Response) => {
    const allTasks = await storage.getAllTasks();
    const allUsers = await storage.getAllUsers();

    const openTasks = allTasks.filter((t) => t.status === TaskStatus.OPEN);
    const completedTasks = allTasks.filter((t) => t.status === TaskStatus.COMPLETED);

    const totalRewards = allTasks.reduce(
      (sum, t) => sum + parseFloat(t.rewardSol),
      0
    );

    res.json({
      tasks: {
        total: allTasks.length,
        open: openTasks.length,
        completed: completedTasks.length,
        totalRewards: totalRewards.toFixed(4),
      },
      workers: {
        total: allUsers.length,
      },
    });
  });

  return httpServer;
}
