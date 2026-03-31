When designing or fixing a feature:

Understand the System First
Trace from parent → child components
Identify data flow, state management, and side effects
Avoid making changes without understanding the full impact
Eliminate Redundancy
Remove duplicate logic, components, and API calls
Consolidate repeated patterns into reusable utilities or hooks
Prefer composition over duplication
Follow DRY Principles
Abstract reusable logic (hooks, services, helpers)
Avoid hardcoding values — use constants/config
Ensure single source of truth for shared logic
Write Modular & Maintainable Code
Break features into small, focused components/functions
Each file should have a single responsibility
Use clear and consistent naming conventions
Keep components under ~200 lines where possible
Ensure Readability
Code should be self-explanatory before comments
Use comments only for complex logic or decisions
Follow consistent formatting and structure
Think About Scalability
Design for future extension, not just current fix
Avoid tightly coupled components
Use proper state management patterns (e.g., Zustand, React Query separation)
Consider performance (memoization, lazy loading, pagination)
Handle Edge Cases
Validate inputs and API responses
Handle loading, error, and empty states properly
Avoid silent failures
Test Your Changes
Ensure no regression in existing functionality
Test both expected and edge-case scenarios
Keep logic testable (pure functions where possible)
Optimize Only When Necessary
Do not prematurely optimize
Focus first on correctness and clarity
Optimize after identifying bottlenecks
Keep It Simple (KISS)
Avoid over-engineering
Prefer simple, predictable solutions over clever ones
