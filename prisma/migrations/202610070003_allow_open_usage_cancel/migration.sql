CREATE OR REPLACE FUNCTION protect_usage() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF OLD.status = 'DONE' AND NOT (
      NEW.status IN ('DONE', 'CANCELLED')
      AND NEW."settlementId" = OLD."settlementId"
      AND NEW.deposit = OLD.deposit
    ) THEN RAISE EXCEPTION 'DONE cannot run again'; END IF;
  END IF;
  RETURN NEW;
END $$;
