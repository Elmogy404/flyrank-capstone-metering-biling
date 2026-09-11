const { execFile } = require("child_process");
const path = require("path");
const { pool } = require("../../src/db");

const CLI_PATH = path.resolve(__dirname, "../../src/jobs/run-reconciliation.js");

afterAll(async () => {
  await pool.end();
});

describe("run-reconciliation.js CLI", () => {
  it("exits 0 on clean state", (done) => {
    execFile("node", [CLI_PATH], { timeout: 15000 }, (err, stdout, stderr) => {
      expect(err).toBeNull();
      done();
    });
  });

  it("is a valid executable script", (done) => {
    execFile("node", ["-e", `require("${CLI_PATH.replace(/\\/g, "\\\\")}")`], { timeout: 10000 }, (err) => {
      expect(err).toBeNull();
      done();
    });
  });
});
