import { publicProcedure } from "../index";
import { z } from "zod";
import OpenAI from "openai";
import { env } from "@orpc-test/env/server";

export type MindMapNode = {
  id: string;
  label: string;
  children?: MindMapNode[];
};

export const aiRouter = {
  generatePlan: publicProcedure
    .input(z.object({ goal: z.string().min(1) }))
    .handler(async ({ input }) => {
      const openai = new OpenAI({
        apiKey: env.AI_API_KEY,
        baseURL: env.AI_API_BASE_URL,
      });

      try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are a helpful task assistant. Break down the user's goal into a hierarchical mind map structure. 
                    Return ONLY a valid JSON object representing the root node.
                    Format:
                    {
                        "id": "root",
                        "label": "Main Goal",
                        "children": [
                            { "id": "sub1", "label": "Subtask 1", "children": [...] }
                        ]
                    }
                    Keep it simple: 1 root, 3-5 main branches, and optional sub-branches. 
                    Do not output markdown code blocks.`
                },
                {
                    role: "user",
                    content: input.goal
                }
            ]
        });

        const content = completion.choices[0]?.message?.content || "{}";
        // Simple cleanup if the model adds markdown
        const cleanedContent = content.replace(/```json|```/g, "").trim();
        
        let rootNode: MindMapNode | null = null;
        try {
            rootNode = JSON.parse(cleanedContent);
        } catch (e) {
            console.error("Failed to parse JSON:", cleanedContent);
        }
        
        if (rootNode && typeof rootNode === 'object' && 'label' in rootNode) {
            return rootNode as MindMapNode;
        }
        // Fallback
        return { id: "root", label: input.goal, children: [] };
      } catch (error) {
          console.error("AI Plan Generation Failed:", error);
          throw error;
      }
    }),
};
