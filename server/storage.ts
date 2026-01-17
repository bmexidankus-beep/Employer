import {
  type User,
  type InsertUser,
  type Task,
  type InsertTask,
  type Submission,
  type InsertSubmission,
  type Payment,
  type InsertPayment,
  type Budget,
  TaskStatus,
  SubmissionStatus,
  PaymentStatus,
} from "@shared/schema";
import { randomUUID } from "crypto";

// Storage interface for all CRUD operations
export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByWallet(walletAddress: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserEarnings(id: string, amount: string): Promise<void>;
  getAllUsers(): Promise<User[]>;

  // Tasks
  getTask(id: string): Promise<Task | undefined>;
  getAllTasks(): Promise<Task[]>;
  getOpenTasks(): Promise<Task[]>;
  getTasksByStatus(status: string): Promise<Task[]>;
  createTask(task: InsertTask): Promise<Task>;
  updateTaskStatus(id: string, status: string): Promise<void>;
  assignTask(taskId: string, workerId: string): Promise<void>;
  incrementTaskSubmissions(id: string): Promise<void>;

  // Submissions
  getSubmission(id: string): Promise<Submission | undefined>;
  getSubmissionsByTask(taskId: string): Promise<Submission[]>;
  getSubmissionsByWorker(workerId: string): Promise<Submission[]>;
  getPendingSubmissions(): Promise<Submission[]>;
  createSubmission(submission: InsertSubmission): Promise<Submission>;
  updateSubmissionStatus(
    id: string,
    status: string,
    verificationResult?: string,
    verificationScore?: string
  ): Promise<void>;

  // Payments
  getPayment(id: string): Promise<Payment | undefined>;
  getPaymentsByWorker(workerId: string): Promise<Payment[]>;
  getPendingPayments(): Promise<Payment[]>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePaymentStatus(
    id: string,
    status: string,
    signature?: string,
    error?: string
  ): Promise<void>;

  // Budget
  getBudget(): Promise<Budget | undefined>;
  updateBudget(balanceSol: string, walletAddress?: string): Promise<void>;
  addToPaidOut(amount: string): Promise<void>;
}

// In-memory storage implementation
export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private tasks: Map<string, Task>;
  private submissions: Map<string, Submission>;
  private payments: Map<string, Payment>;
  private budgetData: Budget | undefined;

  constructor() {
    this.users = new Map();
    this.tasks = new Map();
    this.submissions = new Map();
    this.payments = new Map();
    this.budgetData = undefined;
  }

  // ============== Users ==============

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username
    );
  }

  async getUserByWallet(walletAddress: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.walletAddress === walletAddress
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = {
      ...insertUser,
      id,
      totalEarnings: "0",
      tasksCompleted: 0,
    };
    this.users.set(id, user);
    return user;
  }

  async updateUserEarnings(id: string, amount: string): Promise<void> {
    const user = this.users.get(id);
    if (user) {
      const currentEarnings = parseFloat(user.totalEarnings || "0");
      const addAmount = parseFloat(amount);
      user.totalEarnings = (currentEarnings + addAmount).toString();
      user.tasksCompleted = (user.tasksCompleted || 0) + 1;
      this.users.set(id, user);
    }
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  // ============== Tasks ==============

  async getTask(id: string): Promise<Task | undefined> {
    return this.tasks.get(id);
  }

  async getAllTasks(): Promise<Task[]> {
    return Array.from(this.tasks.values()).sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() -
        new Date(a.createdAt || 0).getTime()
    );
  }

  async getOpenTasks(): Promise<Task[]> {
    return Array.from(this.tasks.values()).filter(
      (task) => task.status === TaskStatus.OPEN
    );
  }

  async getTasksByStatus(status: string): Promise<Task[]> {
    return Array.from(this.tasks.values()).filter(
      (task) => task.status === status
    );
  }

  async createTask(insertTask: InsertTask): Promise<Task> {
    const id = randomUUID();
    const task: Task = {
      ...insertTask,
      id,
      status: TaskStatus.OPEN,
      currentSubmissions: 0,
      createdAt: new Date(),
      assignedTo: null,
      deadline: insertTask.deadline ? new Date(insertTask.deadline) : null,
    };
    this.tasks.set(id, task);
    return task;
  }

  async updateTaskStatus(id: string, status: string): Promise<void> {
    const task = this.tasks.get(id);
    if (task) {
      task.status = status as Task["status"];
      this.tasks.set(id, task);
    }
  }

  async assignTask(taskId: string, workerId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      task.assignedTo = workerId;
      task.status = TaskStatus.IN_PROGRESS;
      this.tasks.set(taskId, task);
    }
  }

  async incrementTaskSubmissions(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (task) {
      task.currentSubmissions = (task.currentSubmissions || 0) + 1;
      if (
        task.maxSubmissions &&
        task.currentSubmissions >= task.maxSubmissions
      ) {
        task.status = TaskStatus.PENDING_VERIFICATION;
      }
      this.tasks.set(id, task);
    }
  }

  // ============== Submissions ==============

  async getSubmission(id: string): Promise<Submission | undefined> {
    return this.submissions.get(id);
  }

  async getSubmissionsByTask(taskId: string): Promise<Submission[]> {
    return Array.from(this.submissions.values()).filter(
      (sub) => sub.taskId === taskId
    );
  }

  async getSubmissionsByWorker(workerId: string): Promise<Submission[]> {
    return Array.from(this.submissions.values()).filter(
      (sub) => sub.workerId === workerId
    );
  }

  async getPendingSubmissions(): Promise<Submission[]> {
    return Array.from(this.submissions.values()).filter(
      (sub) => sub.status === SubmissionStatus.PENDING
    );
  }

  async createSubmission(insertSubmission: InsertSubmission): Promise<Submission> {
    const id = randomUUID();
    const submission: Submission = {
      ...insertSubmission,
      id,
      status: SubmissionStatus.PENDING,
      aiVerificationResult: null,
      aiVerificationScore: null,
      submittedAt: new Date(),
      verifiedAt: null,
    };
    this.submissions.set(id, submission);
    return submission;
  }

  async updateSubmissionStatus(
    id: string,
    status: string,
    verificationResult?: string,
    verificationScore?: string
  ): Promise<void> {
    const submission = this.submissions.get(id);
    if (submission) {
      submission.status = status as Submission["status"];
      if (verificationResult) {
        submission.aiVerificationResult = verificationResult;
      }
      if (verificationScore) {
        submission.aiVerificationScore = verificationScore;
      }
      submission.verifiedAt = new Date();
      this.submissions.set(id, submission);
    }
  }

  // ============== Payments ==============

  async getPayment(id: string): Promise<Payment | undefined> {
    return this.payments.get(id);
  }

  async getPaymentsByWorker(workerId: string): Promise<Payment[]> {
    return Array.from(this.payments.values()).filter(
      (payment) => payment.workerId === workerId
    );
  }

  async getPendingPayments(): Promise<Payment[]> {
    return Array.from(this.payments.values()).filter(
      (payment) => payment.status === PaymentStatus.PENDING
    );
  }

  async createPayment(insertPayment: InsertPayment): Promise<Payment> {
    const id = randomUUID();
    const payment: Payment = {
      ...insertPayment,
      id,
      status: PaymentStatus.PENDING,
      transactionSignature: null,
      errorMessage: null,
      createdAt: new Date(),
      completedAt: null,
    };
    this.payments.set(id, payment);
    return payment;
  }

  async updatePaymentStatus(
    id: string,
    status: string,
    signature?: string,
    error?: string
  ): Promise<void> {
    const payment = this.payments.get(id);
    if (payment) {
      payment.status = status as Payment["status"];
      if (signature) {
        payment.transactionSignature = signature;
      }
      if (error) {
        payment.errorMessage = error;
      }
      if (status === PaymentStatus.COMPLETED) {
        payment.completedAt = new Date();
      }
      this.payments.set(id, payment);
    }
  }

  // ============== Budget ==============

  async getBudget(): Promise<Budget | undefined> {
    return this.budgetData;
  }

  async updateBudget(balanceSol: string, walletAddress?: string): Promise<void> {
    if (!this.budgetData) {
      this.budgetData = {
        id: randomUUID(),
        walletAddress: walletAddress || "",
        balanceSol,
        totalPaidOut: "0",
        lastUpdated: new Date(),
      };
    } else {
      this.budgetData.balanceSol = balanceSol;
      if (walletAddress) {
        this.budgetData.walletAddress = walletAddress;
      }
      this.budgetData.lastUpdated = new Date();
    }
  }

  async addToPaidOut(amount: string): Promise<void> {
    if (this.budgetData) {
      const current = parseFloat(this.budgetData.totalPaidOut || "0");
      const add = parseFloat(amount);
      this.budgetData.totalPaidOut = (current + add).toString();
      this.budgetData.lastUpdated = new Date();
    }
  }
}

export const storage = new MemStorage();
