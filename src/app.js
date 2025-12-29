require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const bcrypt = require("bcrypt");
const methodOverride = require("method-override");

const { openDb } = require("./db");
const { requireAuth, exposeAuth } = require("./middleware/auth");
const { setFlash, exposeFlash } = require("./middleware/flash");

const app = express();

// ---------- Core config ----------
app.set("view engine", "ejs");
app.set("views", path.resolve(__dirname, "views"));

app.use(express.urlencoded({ extended: false }));
app.use(
  methodOverride((req) => {
    if (req.body && typeof req.body._method === "string") return req.body._method;
    if (req.query && typeof req.query._method === "string") return req.query._method;
    return undefined;
  }),
);
app.use("/public", express.static(path.resolve(__dirname, "public")));

// ---------- Sessions ----------
const SQLiteStore = SQLiteStoreFactory(session);
fs.mkdirSync(path.resolve(process.cwd(), "sessions"), { recursive: true });
app.use(
  session({
    store: new SQLiteStore({
      dir: path.resolve(process.cwd(), "sessions"),
      db: "sessions.sqlite",
    }),
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
    },
  }),
);

app.use(exposeFlash);
app.use(exposeAuth);

// ---------- DB ----------
const dbPath = process.env.DATABASE_PATH || "./data/ems.sqlite";
const db = openDb(dbPath);

// Auto-initialize schema (helpful for first run)
try {
  const hasUsersTable = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='users' LIMIT 1",
    )
    .get();
  if (!hasUsersTable) {
    const schemaSql = fs.readFileSync(
      path.resolve(__dirname, "scripts", "schema.sql"),
      "utf8",
    );
    db.exec(schemaSql);

    const existingAdmin = db
      .prepare("SELECT 1 FROM users WHERE username = ?")
      .get("admin");
    if (!existingAdmin) {
      const passwordHash = bcrypt.hashSync("admin123", 12);
      db.prepare(
        "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)",
      ).run("admin", passwordHash, "Administrator");
    }

    const deptCount = db.prepare("SELECT COUNT(*) AS c FROM departments").get().c;
    if (deptCount === 0) {
      const insertDept = db.prepare(
        "INSERT INTO departments (name, description) VALUES (?, ?)",
      );
      insertDept.run("HR", "Hiring, onboarding, and people operations");
      insertDept.run("Engineering", "Product development and maintenance");
      insertDept.run("Finance", "Accounting, payroll, budgeting");
    }

    const roleCount = db.prepare("SELECT COUNT(*) AS c FROM roles").get().c;
    if (roleCount === 0) {
      const insertRole = db.prepare("INSERT INTO roles (name, description) VALUES (?, ?)");
      insertRole.run("Manager", "Team management and delivery");
      insertRole.run("Developer", "Software development");
      insertRole.run("Analyst", "Business analysis and reporting");
    }
  }
} catch (_err) {
  // If schema init fails, the app will error later; db:init script is the canonical path.
}

app.use((req, _res, next) => {
  req.db = db;
  next();
});

function parseIdParam(req) {
  const id = Number(req.params.id);
  return Number.isFinite(id) ? id : null;
}

function uniqueMessage(err, fallback) {
  if (!err || err.code !== "SQLITE_CONSTRAINT_UNIQUE") return fallback;
  if (String(err.message || "").includes(".email")) return "Email already exists.";
  if (String(err.message || "").includes("departments.name"))
    return "Department name already exists.";
  if (String(err.message || "").includes("roles.name"))
    return "Role name already exists.";
  if (String(err.message || "").includes("users.username"))
    return "Username already exists.";
  return fallback;
}

// ---------- Routes ----------
app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.redirect("/login");
});

// Auth
app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.render("login", { title: "Login" });
});

app.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  const user = db
    .prepare(
      "SELECT id, username, password_hash, display_name FROM users WHERE username = ?",
    )
    .get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    setFlash(req, "error", "Invalid username or password.");
    return res.redirect("/login");
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
  };

  const returnTo = req.session.returnTo;
  delete req.session.returnTo;
  res.redirect(returnTo || "/dashboard");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// Dashboard
app.get("/dashboard", requireAuth, (req, res) => {
  const counts = {
    employees: db.prepare("SELECT COUNT(*) AS c FROM employees").get().c,
    departments: db.prepare("SELECT COUNT(*) AS c FROM departments").get().c,
    roles: db.prepare("SELECT COUNT(*) AS c FROM roles").get().c,
    activeEmployees: db
      .prepare("SELECT COUNT(*) AS c FROM employees WHERE status = 'Active'")
      .get().c,
  };

  res.render("dashboard", { title: "Dashboard", counts });
});

// Employees
app.get("/employees", requireAuth, (req, res) => {
  const q = String(req.query.q || "").trim();
  const status = String(req.query.status || "").trim();

  const where = [];
  const params = {};
  if (q) {
    where.push(
      "(e.first_name LIKE @q OR e.last_name LIKE @q OR e.email LIKE @q)",
    );
    params.q = `%${q}%`;
  }
  if (status === "Active" || status === "Inactive") {
    where.push("e.status = @status");
    params.status = status;
  }

  const sql = `
    SELECT
      e.*,
      d.name AS department_name,
      r.name AS role_name
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN roles r ON r.id = e.role_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY e.last_name ASC, e.first_name ASC
  `;

  const employees = db.prepare(sql).all(params);
  res.render("employees/index", {
    title: "Employees",
    employees,
    filters: { q, status },
  });
});

app.get("/employees/new", requireAuth, (req, res) => {
  const departments = db
    .prepare("SELECT id, name FROM departments ORDER BY name ASC")
    .all();
  const roles = db.prepare("SELECT id, name FROM roles ORDER BY name ASC").all();

  res.render("employees/new", {
    title: "Add employee",
    employee: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      department_id: "",
      role_id: "",
      status: "Active",
      hire_date: "",
      notes: "",
    },
    departments,
    roles,
  });
});

app.post("/employees", requireAuth, (req, res) => {
  const body = req.body || {};
  try {
    db.prepare(
      `INSERT INTO employees
        (first_name, last_name, email, phone, department_id, role_id, status, hire_date, notes)
       VALUES
        (@first_name, @last_name, @email, @phone, @department_id, @role_id, @status, @hire_date, @notes)`,
    ).run({
      first_name: String(body.first_name || "").trim(),
      last_name: String(body.last_name || "").trim(),
      email: String(body.email || "").trim(),
      phone: String(body.phone || "").trim() || null,
      department_id: body.department_id ? Number(body.department_id) : null,
      role_id: body.role_id ? Number(body.role_id) : null,
      status: body.status === "Inactive" ? "Inactive" : "Active",
      hire_date: String(body.hire_date || "").trim() || null,
      notes: String(body.notes || "").trim() || null,
    });
    setFlash(req, "success", "Employee created.");
    res.redirect("/employees");
  } catch (err) {
    setFlash(req, "error", uniqueMessage(err, "Failed to create employee."));
    res.redirect("/employees/new");
  }
});

app.get("/employees/:id", requireAuth, (req, res) => {
  const id = parseIdParam(req);
  if (!id) return res.status(404).send("Not found");

  const employee = db
    .prepare(
      `SELECT e.*, d.name AS department_name, r.name AS role_name
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN roles r ON r.id = e.role_id
       WHERE e.id = ?`,
    )
    .get(id);

  if (!employee) return res.status(404).send("Not found");
  res.render("employees/show", { title: "Employee", employee });
});

app.get("/employees/:id/edit", requireAuth, (req, res) => {
  const id = parseIdParam(req);
  if (!id) return res.status(404).send("Not found");

  const employee = db.prepare("SELECT * FROM employees WHERE id = ?").get(id);
  if (!employee) return res.status(404).send("Not found");

  const departments = db
    .prepare("SELECT id, name FROM departments ORDER BY name ASC")
    .all();
  const roles = db.prepare("SELECT id, name FROM roles ORDER BY name ASC").all();

  res.render("employees/edit", {
    title: "Edit employee",
    employee,
    departments,
    roles,
  });
});

app.put("/employees/:id", requireAuth, (req, res) => {
  const id = parseIdParam(req);
  if (!id) return res.status(404).send("Not found");

  const body = req.body || {};
  try {
    const info = db
      .prepare(
        `UPDATE employees SET
          first_name=@first_name,
          last_name=@last_name,
          email=@email,
          phone=@phone,
          department_id=@department_id,
          role_id=@role_id,
          status=@status,
          hire_date=@hire_date,
          notes=@notes
         WHERE id=@id`,
      )
      .run({
        id,
        first_name: String(body.first_name || "").trim(),
        last_name: String(body.last_name || "").trim(),
        email: String(body.email || "").trim(),
        phone: String(body.phone || "").trim() || null,
        department_id: body.department_id ? Number(body.department_id) : null,
        role_id: body.role_id ? Number(body.role_id) : null,
        status: body.status === "Inactive" ? "Inactive" : "Active",
        hire_date: String(body.hire_date || "").trim() || null,
        notes: String(body.notes || "").trim() || null,
      });

    if (info.changes === 0) return res.status(404).send("Not found");
    setFlash(req, "success", "Employee updated.");
    res.redirect(`/employees/${id}`);
  } catch (err) {
    setFlash(req, "error", uniqueMessage(err, "Failed to update employee."));
    res.redirect(`/employees/${id}/edit`);
  }
});

app.delete("/employees/:id", requireAuth, (req, res) => {
  const id = parseIdParam(req);
  if (!id) return res.status(404).send("Not found");

  const info = db.prepare("DELETE FROM employees WHERE id = ?").run(id);
  if (info.changes === 0) return res.status(404).send("Not found");
  setFlash(req, "success", "Employee deleted.");
  res.redirect("/employees");
});

// Departments
app.get("/departments", requireAuth, (req, res) => {
  const departments = db
    .prepare(
      `SELECT d.*,
         (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id) AS employee_count
       FROM departments d
       ORDER BY d.name ASC`,
    )
    .all();
  res.render("departments/index", { title: "Departments", departments });
});

app.get("/departments/new", requireAuth, (req, res) => {
  res.render("departments/new", {
    title: "Add department",
    department: { name: "", description: "" },
  });
});

app.post("/departments", requireAuth, (req, res) => {
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim() || null;
  try {
    db.prepare("INSERT INTO departments (name, description) VALUES (?, ?)").run(
      name,
      description,
    );
    setFlash(req, "success", "Department created.");
    res.redirect("/departments");
  } catch (err) {
    setFlash(req, "error", uniqueMessage(err, "Failed to create department."));
    res.redirect("/departments/new");
  }
});

app.get("/departments/:id/edit", requireAuth, (req, res) => {
  const id = parseIdParam(req);
  if (!id) return res.status(404).send("Not found");
  const department = db.prepare("SELECT * FROM departments WHERE id = ?").get(id);
  if (!department) return res.status(404).send("Not found");
  res.render("departments/edit", { title: "Edit department", department });
});

app.put("/departments/:id", requireAuth, (req, res) => {
  const id = parseIdParam(req);
  if (!id) return res.status(404).send("Not found");
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim() || null;

  try {
    const info = db
      .prepare("UPDATE departments SET name = ?, description = ? WHERE id = ?")
      .run(name, description, id);
    if (info.changes === 0) return res.status(404).send("Not found");
    setFlash(req, "success", "Department updated.");
    res.redirect("/departments");
  } catch (err) {
    setFlash(req, "error", uniqueMessage(err, "Failed to update department."));
    res.redirect(`/departments/${id}/edit`);
  }
});

app.delete("/departments/:id", requireAuth, (req, res) => {
  const id = parseIdParam(req);
  if (!id) return res.status(404).send("Not found");

  try {
    const info = db.prepare("DELETE FROM departments WHERE id = ?").run(id);
    if (info.changes === 0) return res.status(404).send("Not found");
    setFlash(req, "success", "Department deleted.");
    res.redirect("/departments");
  } catch (err) {
    const isFk = err?.code === "SQLITE_CONSTRAINT_FOREIGNKEY";
    setFlash(
      req,
      "error",
      isFk
        ? "Cannot delete a department that has employees."
        : "Failed to delete department.",
    );
    res.redirect("/departments");
  }
});

// Roles
app.get("/roles", requireAuth, (req, res) => {
  const roles = db
    .prepare(
      `SELECT r.*,
         (SELECT COUNT(*) FROM employees e WHERE e.role_id = r.id) AS employee_count
       FROM roles r
       ORDER BY r.name ASC`,
    )
    .all();
  res.render("roles/index", { title: "Roles", roles });
});

app.get("/roles/new", requireAuth, (req, res) => {
  res.render("roles/new", {
    title: "Add role",
    role: { name: "", description: "" },
  });
});

app.post("/roles", requireAuth, (req, res) => {
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim() || null;
  try {
    db.prepare("INSERT INTO roles (name, description) VALUES (?, ?)").run(
      name,
      description,
    );
    setFlash(req, "success", "Role created.");
    res.redirect("/roles");
  } catch (err) {
    setFlash(req, "error", uniqueMessage(err, "Failed to create role."));
    res.redirect("/roles/new");
  }
});

app.get("/roles/:id/edit", requireAuth, (req, res) => {
  const id = parseIdParam(req);
  if (!id) return res.status(404).send("Not found");
  const role = db.prepare("SELECT * FROM roles WHERE id = ?").get(id);
  if (!role) return res.status(404).send("Not found");
  res.render("roles/edit", { title: "Edit role", role });
});

app.put("/roles/:id", requireAuth, (req, res) => {
  const id = parseIdParam(req);
  if (!id) return res.status(404).send("Not found");
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim() || null;

  try {
    const info = db
      .prepare("UPDATE roles SET name = ?, description = ? WHERE id = ?")
      .run(name, description, id);
    if (info.changes === 0) return res.status(404).send("Not found");
    setFlash(req, "success", "Role updated.");
    res.redirect("/roles");
  } catch (err) {
    setFlash(req, "error", uniqueMessage(err, "Failed to update role."));
    res.redirect(`/roles/${id}/edit`);
  }
});

app.delete("/roles/:id", requireAuth, (req, res) => {
  const id = parseIdParam(req);
  if (!id) return res.status(404).send("Not found");

  try {
    const info = db.prepare("DELETE FROM roles WHERE id = ?").run(id);
    if (info.changes === 0) return res.status(404).send("Not found");
    setFlash(req, "success", "Role deleted.");
    res.redirect("/roles");
  } catch (err) {
    const isFk = err?.code === "SQLITE_CONSTRAINT_FOREIGNKEY";
    setFlash(
      req,
      "error",
      isFk ? "Cannot delete a role that has employees." : "Failed to delete role.",
    );
    res.redirect("/roles");
  }
});

// 404
app.use((_req, res) => {
  res.status(404).render("404", { title: "Not found" });
});

module.exports = app;

