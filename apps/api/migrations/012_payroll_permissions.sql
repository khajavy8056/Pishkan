-- Add explicit, separately checked payroll permissions to the accountant role.
-- This is additive: preserve all existing custom permissions and never reset a
-- role's configured permission list. The migration runner applies this once.
UPDATE roles
SET permissions = CASE
  WHEN permissions = '[]' THEN '["payroll.view","payroll.contracts.edit","payroll.accrue","payroll.settle","payroll.reports.view"]'
  WHEN permissions = '*' THEN permissions
  ELSE substr(permissions, 1, length(permissions) - 1)
       || ',"payroll.view","payroll.contracts.edit","payroll.accrue","payroll.settle","payroll.reports.view"]'
END,
updated_at = CURRENT_TIMESTAMP
WHERE code = 'accountant'
  AND permissions <> '*'
  AND permissions NOT LIKE '%payroll.view%';
