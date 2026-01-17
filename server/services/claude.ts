import Anthropic from "@anthropic-ai/sdk";
import type { VerificationResult, Task } from "@shared/schema";

// Claude API service for task verification
// Uses multimodal capabilities to verify proofs

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Verify a task submission using Claude's multimodal capabilities
 * Claude acts as the AI employer, judging if the work meets requirements
 */
export async function verifySubmission(
  task: Task,
  proofType: string,
  proofData: string,
  proofDescription?: string
): Promise<VerificationResult> {
  const systemPrompt = `You are an AI Employer evaluating task submissions. Your role is to:
1. Carefully examine the proof provided by the worker
2. Compare it against the task requirements and verification criteria
3. Determine if the work meets the standards for payment

Be fair but strict. Workers deserve to be paid for legitimate work, but low-quality submissions should be rejected.

Task Details:
- Title: ${task.title}
- Description: ${task.description}
- Type: ${task.taskType}
- Reward: ${task.rewardSol} SOL
- Verification Criteria: ${task.verificationCriteria}

Respond with a JSON object containing:
{
  "approved": boolean,
  "score": number (0-100),
  "reasoning": "detailed explanation of your decision",
  "suggestions": ["optional array of improvement suggestions if rejected"]
}`;

  try {
    let messageContent: Anthropic.MessageCreateParams["messages"][0]["content"];

    if (proofType === "image") {
      // Multimodal verification with image
      messageContent = [
        {
          type: "text",
          text: `Please verify this task submission.\n\nProof Description: ${proofDescription || "No description provided"}\n\nAnalyze the image proof below:`,
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: proofData.replace(/^data:image\/\w+;base64,/, ""),
          },
        },
      ];
    } else if (proofType === "url") {
      // URL-based verification
      messageContent = `Please verify this task submission.

Proof Type: URL
Proof URL: ${proofData}
Proof Description: ${proofDescription || "No description provided"}

Analyze if this URL proof satisfies the task requirements. Consider:
- Does the URL point to valid content?
- Does the content match the task description?
- Is the work quality acceptable?`;
    } else {
      // Text-based verification
      messageContent = `Please verify this task submission.

Proof Type: Text
Proof Content:
---
${proofData}
---

Proof Description: ${proofDescription || "No description provided"}

Analyze if this text proof satisfies the task requirements.`;
    }

    const response = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: messageContent,
        },
      ],
    });

    // Parse the JSON response
    const textContent = response.content.find((block) => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude");
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = textContent.text;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const result = JSON.parse(jsonStr);

    return {
      approved: result.approved === true,
      score: Math.max(0, Math.min(100, Number(result.score) || 0)),
      reasoning: result.reasoning || "No reasoning provided",
      suggestions: Array.isArray(result.suggestions) ? result.suggestions : undefined,
    };
  } catch (error) {
    console.error("Claude verification error:", error);
    return {
      approved: false,
      score: 0,
      reasoning: `Verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      suggestions: ["Please try submitting again with clearer proof"],
    };
  }
}

/**
 * Generate tasks for workers based on project needs
 * Claude as Product Manager creates actionable tasks
 */
export async function generateTasks(
  projectContext: string,
  budgetSol: number,
  taskCount: number = 5
): Promise<Array<{
  title: string;
  description: string;
  taskType: string;
  rewardSol: string;
  verificationCriteria: string;
}>> {
  const prompt = `You are an AI Product Manager for a crypto project. Generate ${taskCount} tasks for human workers.

Project Context: ${projectContext}
Available Budget: ${budgetSol} SOL

Create diverse tasks that help promote and build the project. Mix of:
- Social media tasks (tweets, threads)
- Marketing tasks (showing logo IRL, community engagement)
- Code tasks (github contributions)
- Design tasks (memes, graphics)

For each task, provide:
- title: Short, clear task name
- description: Detailed instructions
- taskType: "code" | "social" | "marketing" | "design" | "other"
- rewardSol: Amount in SOL (be fair, consider difficulty)
- verificationCriteria: Specific requirements for approval

Respond with a JSON array of tasks.`;

  try {
    const response = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const textContent = response.content.find((block) => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude");
    }

    let jsonStr = textContent.text;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Task generation error:", error);
    return [];
  }
}

/**
 * Analyze budget and suggest payment strategy
 */
export async function analyzeBudget(
  currentBalance: number,
  pendingPayments: number,
  completedTasks: number
): Promise<{
  recommendation: string;
  suggestedActions: string[];
  healthScore: number;
}> {
  const prompt = `As an AI Finance Manager, analyze this budget situation:

Current Balance: ${currentBalance} SOL
Pending Payments: ${pendingPayments} SOL
Completed Tasks: ${completedTasks}

Provide:
1. A brief recommendation
2. Suggested actions (as array)
3. Health score (0-100)

Respond with JSON: { "recommendation": "...", "suggestedActions": [...], "healthScore": number }`;

  try {
    const response = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const textContent = response.content.find((block) => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response");
    }

    let jsonStr = textContent.text;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    return JSON.parse(jsonStr);
  } catch (error) {
    return {
      recommendation: "Unable to analyze budget at this time",
      suggestedActions: ["Check balance manually"],
      healthScore: 50,
    };
  }
}
