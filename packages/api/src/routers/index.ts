import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { todoRouter } from "./todo";
import { aiRouter } from "./ai";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  todo: todoRouter,
  ai: aiRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
