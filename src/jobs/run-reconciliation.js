require("dotenv").config();

const { ReconciliationJob } = require("./reconciliation.job");

async function main() {
  const job = new ReconciliationJob();
  const result = await job.run();

  if (result.errors.length > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main().catch(() => {
  process.exit(1);
});
