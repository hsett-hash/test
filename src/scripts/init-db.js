const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
require("dotenv").config();

const { openDb } = require("../db");

function readSchema() {
  const schemaPath = path.resolve(__dirname, "schema.sql");
  return fs.readFileSync(schemaPath, "utf8");
}

function ensureSeedData(db) {
  const hasAdmin = db
    .prepare("SELECT 1 FROM users WHERE username = ?")
    .get("admin");

  if (!hasAdmin) {
    const passwordHash = bcrypt.hashSync("admin123", 12);
    db.prepare(
      "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)",
    ).run("admin", passwordHash, "Administrator");
  }

  const departmentCount = db.prepare("SELECT COUNT(*) AS c FROM departments").get()
    .c;
  if (departmentCount === 0) {
    const insertDept = db.prepare(
      "INSERT INTO departments (name, description) VALUES (?, ?)",
    );
    insertDept.run("HR", "Hiring, onboarding, and people operations");
    insertDept.run("Engineering", "Product development and maintenance");
    insertDept.run("Finance", "Accounting, payroll, budgeting");
  }

  const roleCount = db.prepare("SELECT COUNT(*) AS c FROM roles").get().c;
  if (roleCount === 0) {
    const insertRole = db.prepare(
      "INSERT INTO roles (name, description) VALUES (?, ?)",
    );
    insertRole.run("Manager", "Team management and delivery");
    insertRole.run("Developer", "Software development");
    insertRole.run("Analyst", "Business analysis and reporting");
  }

  const employeeCount = db.prepare("SELECT COUNT(*) AS c FROM employees").get().c;
  if (employeeCount === 0) {
    const engineering = db
      .prepare("SELECT id FROM departments WHERE name = ?")
      .get("Engineering")?.id;
    const developer = db
      .prepare("SELECT id FROM roles WHERE name = ?")
      .get("Developer")?.id;

    db.prepare(
      `INSERT INTO employees
        (first_name, last_name, email, phone, department_id, role_id, status, hire_date, notes)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "Ava",
      "Patel",
      "ava.patel@example.com",
      "+1-555-0101",
      engineering ?? null,
      developer ?? null,
      "Active",
      "2025-01-15",
      "Seed employee record",
    );
  }
}

function main() {
  const dbPath = process.env.DATABASE_PATH || "./data/ems.sqlite";
  const db = openDb(dbPath);

  db.exec(readSchema());
  ensureSeedData(db);

  const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  const deptCount = db.prepare("SELECT COUNT(*) AS c FROM departments").get().c;
  const roleCount = db.prepare("SELECT COUNT(*) AS c FROM roles").get().c;
  const empCount = db.prepare("SELECT COUNT(*) AS c FROM employees").get().c;

  console.log(
    `DB ready: ${dbPath} (users=${userCount}, departments=${deptCount}, roles=${roleCount}, employees=${empCount})`,
  );
}

main();

