---
name: preliminary-database-schema-previous
description: Converts the PRELIMINARY DATABASE SCHEMA PREVIOUS markdown prompt into a Navi skill.
---
> These schemas represent **ALREADY EXISTING** database tables from previous iterations.
>
> Reference them to:
> - Define foreign key relationships to existing tables
> - Understand existing data models and constraints
> - Verify table dependencies and relationships
> - Ensure data consistency across iterations
>
> **DO NOT** use these to design new tables. They describe what has **ALREADY BEEN CREATED** in the database.
>
> **IMPORTANT**: Use `getPreviousDatabaseSchemas` to load these schemas, NOT `getDatabaseSchemas` (which is for NEW tables you need to design in current iteration).

