import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Task Status enum
export const TaskStatus = {
  OPEN: "open",
  IN_PROGRESS: "in_progress",
  PENDING_VERIFICATION: "pending_verification",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;

export type TaskStatusType = typeof TaskStatus[keyof typeof TaskStatus];

// Submission Status enum
export const SubmissionStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

export type SubmissionStatusType = typeof SubmissionStatus[keyof typeof SubmissionStatus];

// Payment Status enum
export const PaymentStatus = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type PaymentStatusType = typeof PaymentStatus[keyof typeof PaymentStatus];

// Task Types
export const TaskType = {
  CODE: "code",
  SOCIAL: "social",
  MARKETING: "marketing",
  DESIGN: "design",
  OTHER: "other",
} as const;

export type TaskTypeValue = typeof TaskType[keyof typeof TaskType];

// ============== TABLES ==============

// Users/Workers table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  walletAddress: text("wallet_address"),
  totalEarnings: decimal("total_earnings", { precision: 18, scale: 9 }).default("0"),
  tasksCompleted: integer("tasks_completed").default(0),
});

// Tasks table - created by AI employer
export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  taskType: text("task_type").notNull().$type<TaskTypeValue>(),
  rewardSol: decimal("reward_sol", { precision: 18, scale: 9 }).notNull(),
  status: text("status").notNull().$type<TaskStatusType>().default("open"),
  verificationCriteria: text("verification_criteria").notNull(),
  maxSubmissions: integer("max_submissions").default(1),
  currentSubmissions: integer("current_submissions").default(0),
  deadline: timestamp("deadline"),
  createdAt: timestamp("created_at").defaultNow(),
  assignedTo: varchar("assigned_to"),
});

// Submissions table - proofs submitted by workers
export const submissions = pgTable("submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  taskId: varchar("task_id").notNull(),
  workerId: varchar("worker_id").notNull(),
  proofType: text("proof_type").notNull(), // "image", "url", "text"
  proofData: text("proof_data").notNull(), // base64 image, URL, or text content
  proofDescription: text("proof_description"),
  status: text("status").notNull().$type<SubmissionStatusType>().default("pending"),
  aiVerificationResult: text("ai_verification_result"),
  aiVerificationScore: decimal("ai_verification_score", { precision: 5, scale: 2 }),
  submittedAt: timestamp("submitted_at").defaultNow(),
  verifiedAt: timestamp("verified_at"),
});

// Payments table - SOL payments to workers
export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  submissionId: varchar("submission_id").notNull(),
  taskId: varchar("task_id").notNull(),
  workerId: varchar("worker_id").notNull(),
  walletAddress: text("wallet_address").notNull(),
  amountSol: decimal("amount_sol", { precision: 18, scale: 9 }).notNull(),
  status: text("status").notNull().$type<PaymentStatusType>().default("pending"),
  transactionSignature: text("transaction_signature"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

// Wallet/Budget tracking
export const budget = pgTable("budget", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  walletAddress: text("wallet_address").notNull(),
  balanceSol: decimal("balance_sol", { precision: 18, scale: 9 }).default("0"),
  totalPaidOut: decimal("total_paid_out", { precision: 18, scale: 9 }).default("0"),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

// ============== INSERT SCHEMAS ==============

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  walletAddress: true,
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  status: true,
  currentSubmissions: true,
  createdAt: true,
  assignedTo: true,
});

export const insertSubmissionSchema = createInsertSchema(submissions).omit({
  id: true,
  status: true,
  aiVerificationResult: true,
  aiVerificationScore: true,
  submittedAt: true,
  verifiedAt: true,
});

export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true,
  status: true,
  transactionSignature: true,
  errorMessage: true,
  createdAt: true,
  completedAt: true,
});

// ============== TYPES ==============

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

export type InsertSubmission = z.infer<typeof insertSubmissionSchema>;
export type Submission = typeof submissions.$inferSelect;

export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof payments.$inferSelect;

export type Budget = typeof budget.$inferSelect;

// ============== API TYPES ==============

// Task creation request from AI employer
export const createTaskRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  taskType: z.enum(["code", "social", "marketing", "design", "other"]),
  rewardSol: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0),
  verificationCriteria: z.string().min(1),
  maxSubmissions: z.number().int().positive().optional().default(1),
  deadline: z.string().datetime().optional(),
});

export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

// Submission request from worker
export const submitProofRequestSchema = z.object({
  taskId: z.string().min(1),
  workerId: z.string().min(1),
  proofType: z.enum(["image", "url", "text"]),
  proofData: z.string().min(1),
  proofDescription: z.string().optional(),
});

export type SubmitProofRequest = z.infer<typeof submitProofRequestSchema>;

// Verification result from Claude
export interface VerificationResult {
  approved: boolean;
  score: number; // 0-100
  reasoning: string;
  suggestions?: string[];
}

// Creator rewards response
export interface CreatorRewardsInfo {
  walletAddress: string;
  balanceSol: number;
  claimableRewards: number;
  lastUpdated: Date;
}

// Transaction result
export interface TransactionResult {
  success: boolean;
  signature?: string;
  error?: string;
}
