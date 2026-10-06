ALTER TABLE "Key" ADD CONSTRAINT "Key_stk_digits" CHECK ("normalizedStk" ~ '^[0-9]{3,30}$');
ALTER TABLE "User" ADD CONSTRAINT "User_parent_role" CHECK ((role = 'CTV_CON' AND "parentCtvId" IS NOT NULL) OR (role <> 'CTV_CON' AND "parentCtvId" IS NULL));
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_nonnegative" CHECK (deposit > 0 AND withdrawal >= 0);
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_date" CHECK (date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

CREATE FUNCTION protect_usage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "Settlement"; old_s "Settlement"; owner_id text; parent_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Usage history cannot be deleted'; END IF;
  SELECT * INTO s FROM "Settlement" WHERE id = NEW."settlementId" FOR UPDATE;
  IF s.status <> 'OPEN' THEN RAISE EXCEPTION 'Settlement is locked'; END IF;
  SELECT "parentCtvId" INTO parent_id FROM "User" WHERE id = s."workerId";
  IF EXISTS (SELECT 1 FROM "Settlement" WHERE "workerId" = parent_id AND date = s.date AND status <> 'OPEN') THEN
    RAISE EXCEPTION 'Parent settlement is locked';
  END IF;
  SELECT "ownerId" INTO owner_id FROM "Key" WHERE id = NEW."keyId";
  IF owner_id IS DISTINCT FROM s."workerId" THEN RAISE EXCEPTION 'Key ownership mismatch'; END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT * INTO old_s FROM "Settlement" WHERE id = OLD."settlementId";
    IF OLD.status <> 'CANCELLED' AND old_s.status <> 'OPEN' THEN RAISE EXCEPTION 'History is locked'; END IF;
    IF NEW."keyId" <> OLD."keyId" OR NEW."platformId" <> OLD."platformId" THEN RAISE EXCEPTION 'Usage identity is immutable'; END IF;
    IF OLD.status = 'DONE' AND (NEW.status <> 'DONE' OR NEW."settlementId" <> OLD."settlementId" OR NEW.deposit <> OLD.deposit) THEN RAISE EXCEPTION 'DONE cannot run again'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER usage_guard BEFORE INSERT OR UPDATE OR DELETE ON "Usage" FOR EACH ROW EXECUTE FUNCTION protect_usage();

CREATE FUNCTION protect_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Settlement history cannot be deleted'; END IF;
  IF NEW."workerId" <> OLD."workerId" OR NEW.date <> OLD.date THEN RAISE EXCEPTION 'Settlement identity is immutable'; END IF;
  IF OLD.status = 'PAID' THEN RAISE EXCEPTION 'PAID is immutable'; END IF;
  IF OLD.status <> 'OPEN' AND (to_jsonb(NEW) - 'status' - 'paidAt') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'paidAt') THEN RAISE EXCEPTION 'Closed financial snapshot is immutable'; END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status = 'OPEN' AND NEW.status = 'CLOSED') OR (OLD.status = 'CLOSED' AND NEW.status = 'APPROVED') OR (OLD.status = 'APPROVED' AND NEW.status = 'PAID')) THEN RAISE EXCEPTION 'Invalid settlement transition'; END IF;
  IF NEW.status = 'CLOSED' AND OLD.status = 'OPEN' THEN
    IF EXISTS (SELECT 1 FROM "Usage" WHERE "settlementId" = OLD.id AND status = 'ACTIVE') THEN RAISE EXCEPTION 'Unfinished usage'; END IF;
    IF EXISTS (SELECT 1 FROM "Settlement" c JOIN "User" w ON w.id = c."workerId" WHERE w."parentCtvId" = NEW."workerId" AND c.date = NEW.date AND c.status = 'OPEN' AND EXISTS (SELECT 1 FROM "Usage" u WHERE u."settlementId" = c.id AND u.status <> 'CANCELLED')) THEN RAISE EXCEPTION 'Child settlement must close first'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER settlement_guard BEFORE UPDATE OR DELETE ON "Settlement" FOR EACH ROW EXECUTE FUNCTION protect_settlement();

CREATE FUNCTION protect_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit is append-only'; END $$;
CREATE TRIGGER audit_guard BEFORE UPDATE OR DELETE ON "Audit" FOR EACH ROW EXECUTE FUNCTION protect_audit();

CREATE FUNCTION protect_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."normalizedStk" <> OLD."normalizedStk" THEN RAISE EXCEPTION 'Master STK is immutable'; END IF;
  IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId" AND EXISTS (SELECT 1 FROM "Usage" WHERE "keyId" = OLD.id) THEN RAISE EXCEPTION 'Historical key ownership is immutable'; END IF;
  IF (to_jsonb(NEW) - 'archived') IS DISTINCT FROM (to_jsonb(OLD) - 'archived') AND EXISTS (SELECT 1 FROM "Usage" u JOIN "Settlement" s ON s.id = u."settlementId" WHERE u."keyId" = OLD.id AND s.status <> 'OPEN') THEN RAISE EXCEPTION 'Closed key is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER key_guard BEFORE UPDATE ON "Key" FOR EACH ROW EXECUTE FUNCTION protect_key();

CREATE FUNCTION protect_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'CTV_CON' AND NOT EXISTS (SELECT 1 FROM "User" WHERE id = NEW."parentCtvId" AND role = 'CTV') THEN RAISE EXCEPTION 'Parent must be CTV'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.role <> OLD.role OR NEW."parentCtvId" IS DISTINCT FROM OLD."parentCtvId") THEN RAISE EXCEPTION 'Financial role is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hierarchy_guard BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION protect_hierarchy();
