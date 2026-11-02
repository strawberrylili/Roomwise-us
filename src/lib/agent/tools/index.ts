import type { Tool } from "../types";
import { askUser, finish } from "./control";
import { generateDesignPlan, selectDirection } from "./design";
import { compareProducts, optimizeBudget, searchProducts } from "./products";
import { critiqueRender, generateRoomImage, renderConcept } from "./render";
import { analyzeRoom, getPreferences, updateProject } from "./room";
import { createTasks } from "./tasks";

export const TOOLS: Tool[] = [
  analyzeRoom,
  getPreferences,
  updateProject,
  generateDesignPlan,
  selectDirection,
  searchProducts,
  compareProducts,
  renderConcept,
  optimizeBudget,
  generateRoomImage,
  critiqueRender,
  createTasks,
  askUser,
  finish,
] as Tool[];
