import { MongoClient } from "./node_modules/.pnpm/mongodb@6.20.0/node_modules/mongodb/lib/index.js";
const client = new MongoClient("mongodb://127.0.0.1:27017/test");
await client.connect();
const db = client.db("test");
const rx = /^(Zz Import QA|Report QA|Temp Co-Accused)/;
const clients = await db.collection("clients").find({ fullName: rx, isDeleted: true }).toArray();
const ids = clients.map((c) => c.id);
const cases = await db.collection("cases").find({ clientId: { $in: ids } }).toArray();
const caseIds = cases.map((c) => c.id);
for (const col of ["payments", "notes", "casedocuments", "courtdates", "appointments", "invoices", "trustentries"]) {
  const r = await db.collection(col).deleteMany({ caseId: { $in: caseIds } });
  if (r.deletedCount) console.log(" ", col, r.deletedCount);
}
console.log("cases removed", (await db.collection("cases").deleteMany({ id: { $in: caseIds } })).deletedCount);
console.log("clients removed", (await db.collection("clients").deleteMany({ id: { $in: ids } })).deletedCount);
console.log("final -> cases", await db.collection("cases").countDocuments({}), "clients", await db.collection("clients").countDocuments({}), "payments", await db.collection("payments").countDocuments({}));
const live = await db.collection("cases").find({ isDeleted: false }).toArray();
console.log("live files:", live.map((c) => `#${c.caseNumber}`).join(", "));
await client.close();
