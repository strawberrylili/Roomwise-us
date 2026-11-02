# Roomwise AI — Autonomous Interior Design Agent

## Product Overview

Build an AI-powered interior design agent that transforms a user's room into a beautifully designed, practical, and achievable living space.

The user uploads photos of their room, describes their desired aesthetic, and provides a budget and constraints. The agent autonomously analyzes the space, develops design strategies, generates visual concepts, researches real products, optimizes the budget, and produces an actionable makeover plan.

Core principle: The user defines the desired outcome. The agent determines and executes the steps required to achieve it.

## Core Agent Capabilities

1. Room Understanding
   - Accept multiple room photos and optional dimensions.
   - Use multimodal AI to identify furniture, architecture, colors, lighting, and spatial constraints.
   - Build a structured room profile.
   - Ask the user to clarify uncertain observations.
2. Preference Discovery
   - Understand the user's desired interior style, colors, materials, and atmosphere.
   - Support visual inspiration selection.
   - Learn preferences through user feedback.
   - Persist preferences across sessions.
3. Autonomous Design Planning
   - Evaluate the existing room and identify improvement opportunities.
   - Generate multiple design strategies.
   - Prioritize changes based on visual impact, budget, and feasibility.
   - Respect constraints such as existing furniture, rental restrictions, and budget.
   - Explain design decisions.
4. Visual Design Generation
   - Generate redesigned room images using the original room photos as references.
   - Preserve existing architectural features and furniture where possible.
   - Support iterative revisions through natural language.
   - Maintain consistency across design iterations.
5. Product Research
   - Search real furniture and home decor products.
   - Compare prices, dimensions, materials, reviews, and aesthetics.
   - Match products to the selected design.
   - Find alternatives when products exceed budget or are unavailable.
6. Budget Optimization
   - Allocate the available budget across makeover categories.
   - Prioritize high-impact purchases.
   - Compare different spending strategies.
   - Recalculate the plan when the user changes constraints.
7. Makeover Execution
   - Generate an ordered implementation checklist.
   - Track purchases and task completion.
   - Review progress photos.
   - Recommend adjustments based on actual results.

## Agent Architecture

One primary orchestrator agent with tool-calling capabilities.

| Tool                   | Responsibility                                  |
| ---------------------- | ----------------------------------------------- |
| `analyze_room`         | Extract structured information from room photos |
| `get_preferences`      | Retrieve user design preferences                |
| `generate_design_plan` | Develop design strategies                       |
| `generate_room_image`  | Generate visual room transformations            |
| `search_products`      | Discover real products                          |
| `compare_products`     | Evaluate and rank product options               |
| `optimize_budget`      | Allocate and validate spending                  |
| `create_tasks`         | Generate makeover checklists                    |
| `update_project`       | Persist project state and decisions             |

The orchestrator autonomously decides which tools to invoke, in what order, and whether additional iterations are necessary.

Execution loop:
- Goal and constraint tracking.
- Dynamic tool selection.
- Intermediate result evaluation.
- Error handling and retries.
- Maximum iteration limits.
- Human approval for consequential actions.

Avoid unnecessary multi-agent complexity in the MVP.

## User Experience

A visual-first interior design studio, not a traditional chatbot interface.

1. Project Workspace: Room photos, room profile, and makeover progress.
2. Design Studio: Inspiration, moodboards, color palettes, and generated concepts.
3. Shopping List: Product recommendations, prices, and budget breakdown.
4. Execution Plan: Actionable tasks and progress tracking.
5. AI Designer: Persistent conversational interface for instructions and design revisions.

The visual workspace is the primary interface. Chat complements it.

## Technical Stack

- Frontend: Next.js, React, TypeScript, Tailwind, shadcn/ui.
- Backend: Next.js API routes.
- Agent: OpenAI API with tool calling.
- Vision: Multimodal LLM.
- Image generation: Image generation API.
- Database: Supabase / PostgreSQL.
- Storage: Supabase Storage.
- Validation: Zod.
- Background jobs: Inngest, if needed.

Persist room profiles, user preferences, design plans, tool execution history, generated images, shopping lists, and task progress.

## MVP Scope

Bedroom makeovers only. End-to-end workflow:

1. Upload room photos.
2. Analyze and confirm room characteristics.
3. Specify aesthetic preferences, budget, and constraints.
4. Agent generates a structured design plan.
5. Agent generates redesigned room images.
6. User requests revisions conversationally.
7. Agent searches for real products.
8. Agent produces a budget breakdown and implementation checklist.
9. Project state persists across sessions.

## Engineering Success Criteria

The agent must:
- Make autonomous decisions about tool selection.
- Adapt its execution strategy based on intermediate results.
- Maintain context across multiple interactions.
- Respect user constraints throughout execution.
- Recover from unsuccessful tool calls.
- Evaluate whether its proposed outcome satisfies the user's goal.

Product vision: A beautiful AI interior designer on the surface, with a genuinely capable autonomous agent underneath.
