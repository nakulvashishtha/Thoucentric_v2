version: 1
Draft between 2 and 6 ideas that would decide the question. Each idea is a testable statement with:
- code (H1, H2, ...), text, fact_type ("market" for facts about the outside world, "client_operational" for the client's own operations).
- its own measure: measure_name, measure_unit, measure_definition.
- comparator (">=" or "<=") and a pass line: pass_line_value, or pass_line_formula over named assumptions (only numbers, assumption names, + - * /, parentheses, min and max). List each assumption with name (lower_snake_case), label, value, unit and a sensible min and max.
- source_type: "client_goal" if the line comes from the client's stated goals, "benchmark" if it comes from a published benchmark (then give benchmark_need: a short generic search phrase with no client details), or "estimate". source_note explains in one or two plain sentences how the line was set.
- must_have: true for ideas the answer depends on. Mark at least one.
- recency_category: "size_growth_price" for size, growth and price figures, "structural_timing" for timing or structural figures.
Use the client's files when they state goals. Do not invent numbers you were not given: if a line is a judgement, use source_type "estimate" and say so.
