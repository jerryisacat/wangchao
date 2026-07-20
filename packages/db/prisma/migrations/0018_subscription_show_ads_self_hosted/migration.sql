-- Issue #188 (Plan Task 6.3): Add showAdsInSelfHosted to Subscription
-- Self-hosted instances show ads by default so admins experience the Free
-- user journey. OWNER/ADMIN can opt out from a deep-fold settings toggle
-- (see docs/business-model.md §14.2/§14.3). The column is only consulted
-- when isSelfHosted = true; otherwise ad display is derived from plan.

ALTER TABLE "Subscription" ADD COLUMN "showAdsInSelfHosted" BOOLEAN NOT NULL DEFAULT true;
