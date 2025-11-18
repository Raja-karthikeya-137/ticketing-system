// Load environment variables
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === Serve frontend ===
app.use(express.static("public"));

// --- Ensure uploads folder exists ---
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Serve uploaded files
app.use("/uploads", express.static(uploadDir));

/* ===========================================================
   MongoDB Connection (required for Render)
   =========================================================== */

const uri = process.env.MONGO_URI;   // ❗ MUST COME FROM ENV
console.log("🔎 Using Mongo URI:", uri ? "Loaded" : "MISSING");

const client = new MongoClient(uri, {
  serverApi: { version: "1", strict: true, deprecationErrors: true }
});

let applications, tickets;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db("mahalakshmiBusDB");
    applications = db.collection("applications");
    tickets = db.collection("tickets");
    console.log("✅ Connected to MongoDB Atlas");
  } catch (err) {
    console.error("❌ Failed to connect MongoDB:", err.message);
  }
}
connectDB();

/* ===========================================================
   File upload setup
   =========================================================== */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// Generate PASS ID
function generateUniquePassId() {
  const randomNum = Math.floor(10000000 + Math.random() * 90000000);
  return `TSRTC-${randomNum}`;
}

/* ===========================================================
   1️⃣ Save Application
   =========================================================== */
app.post(
  "/apply",
  upload.fields([{ name: "photo" }, { name: "aadharFile" }]),
  async (req, res) => {
    try {
      if (!applications)
        return res.status(500).json({ error: "DB not connected" });

      const passId = generateUniquePassId();
      const qrDataUrl = await QRCode.toDataURL(passId);

      const phoneNumber = req.body.phone || req.body.whatsapp || req.body.number;

      const doc = {
        passId,
        qrCode: qrDataUrl,
        name: req.body.name,
        fatherName: req.body.fatherName,
        dob: req.body.dob,
        gender: req.body.gender,
        age: {
          years: req.body.ageYears,
          months: req.body.ageMonths,
          days: req.body.ageDays,
        },
        aadhar: req.body.aadhar,
        phone: phoneNumber,
        whatsapp: req.body.whatsapp || phoneNumber,
        number: req.body.number || phoneNumber,
        email: req.body.email,
        photo: req.files?.photo ? `/uploads/${req.files.photo[0].filename}` : "",
        aadharFile: req.files?.aadharFile ? `/uploads/${req.files.aadharFile[0].filename}` : "",
        address: req.body.address,
        district: req.body.district,
        mandal: req.body.mandal,
        village: req.body.village,
        pincode: req.body.pincode,
        city: req.body.city,
        passType: req.body.passType,
        paymentMode: "FREE SCHEME",
        deliveryMode: "Bus Pass Counter",
        counter: req.body.counter,
        createdAt: new Date(),
      };

      const result = await applications.insertOne(doc);

      res.json({
        success: true,
        message: "Application stored",
        id: result.insertedId,
        passId,
        qrCode: qrDataUrl,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/* ===========================================================
   2️⃣ Verify by Phone
   =========================================================== */
app.get("/verify/:phone", async (req, res) => {
  try {
    const phone = req.params.phone;
    const applicant = await applications.findOne({
      $or: [{ phone }, { whatsapp: phone }, { number: phone }]
    });

    res.json(applicant ? { success: true, id: applicant._id } : { success: false });
  } catch {
    res.status(500).json({ success: false });
  }
});

/* ===========================================================
   3️⃣ Get Applicant by ID
   =========================================================== */
app.get("/applicant/:id", async (req, res) => {
  try {
    const applicant = await applications.findOne({
      _id: new ObjectId(req.params.id)
    });
    res.json(applicant ? { success: true, applicant } : { success: false });
  } catch {
    res.status(500).json({ success: false });
  }
});

/* ===========================================================
   4️⃣ QR Scan → Fetch user by PASS ID
   =========================================================== */
app.get("/getApplicant/:passId", async (req, res) => {
  try {
    const applicant = await applications.findOne({ passId: req.params.passId });
    if (!applicant) return res.status(404).json({ success: false });
    res.json(applicant);
  } catch {
    res.status(500).json({ success: false });
  }
});

/* ===========================================================
   5️⃣ Book Ticket
   =========================================================== */
app.post("/bookTicket", async (req, res) => {
  try {
    const { applicantId, source, destination, paymentType, amount } = req.body;

    if (!applicantId || !source || !destination || !paymentType)
      return res.json({ success: false, msg: "Missing fields" });

    const ticketDoc = {
      applicantId: new ObjectId(applicantId),
      source,
      destination,
      paymentType,
      amount: paymentType === "PAID" ? Number(amount) : 0,
      bookedAt: new Date(),
    };

    const result = await tickets.insertOne(ticketDoc);
    res.json({ success: true, ticket: ticketDoc });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ===========================================================
   DEBUG ROUTE
   =========================================================== */
app.get("/check-uri", (req, res) => {
  res.send("MONGO_URI = " + process.env.MONGO_URI);
});

/* ===========================================================
   Start Server
   =========================================================== */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
