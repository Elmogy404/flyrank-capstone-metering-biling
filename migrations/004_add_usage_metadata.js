/**
 * @param {import('node-pg-migrate').MigrationBuilder} pbm
 */
exports.up = (pbm) => {
  pbm.sql(`
    ALTER TABLE usage_events
      ADD COLUMN metadata JSONB;
  `);
};

exports.down = (pbm) => {
  pbm.sql(`
    ALTER TABLE usage_events
      DROP COLUMN IF EXISTS metadata;
  `);
};
