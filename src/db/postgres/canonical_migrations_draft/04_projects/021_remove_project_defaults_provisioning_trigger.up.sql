BEGIN;

-- Project creation is now provisioned explicitly by ProjectService in one
-- application transaction. Leaving this trigger enabled makes the database
-- insert default environments immediately after the project row is inserted,
-- then ProjectService tries to insert the same Production environment and hits
-- uq_project_environments_active_slug.
DROP TRIGGER IF EXISTS trg_projects_provision_defaults ON projects;
DROP FUNCTION IF EXISTS provision_project_schema_defaults();

COMMIT;
