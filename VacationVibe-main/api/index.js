const express = require("express");
const cors = require("cors");
const { default: mongoose } = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const imageDownloader = require("image-downloader");
//const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs = require('fs');
const multer = require("multer");
const mime = require("mime-types");
const User = require("./models/User");
const Place = require("./models/Place");
const Booking = require("./models/Booking");
require("dotenv").config();
mongoose.connect(process.env.MONGO_URL); // Call once at startup
console.log("ENV loaded:", {
  base64Exists: !!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
  bucket: process.env.FIREBASE_STORAGE_BUCKET,
});
const admin = require('firebase-admin');

// Decode the Base64 string back to JSON
const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
const serviceAccount = JSON.parse(serviceAccountJson);
//const serviceAccount = require('./firebase-adminsdk.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});

const bcryptSalt = bcrypt.genSaltSync(10);
const jwtSecret = "WU6Ex4KaMD1rT85GVXxqLTq5G&UK8mPqYwUe$RMm";
// const bucket = process.env.S3_BUCKET;
const bucket = admin.storage().bucket();

const app = express();

app.use(express.json());

app.use(cookieParser());

app.use(
  cors({
    credentials: true,
    origin: process.env.CLIENT_BASE_URL,
  })
);

async function uploadToFirebaseStorage(localFilePath, originalFilename, mimetype) {
  const parts = originalFilename.split(".");
  const ext = parts[parts.length - 1];
  const newFilename = Date.now() + "." + ext;

  const destination = `uploads/${newFilename}`;
  const file = bucket.file(destination);

  await bucket.upload(localFilePath, {
    destination,
    metadata: {
      contentType: mimetype,
    },
  });

  // Make the file publically accessible
  await file.makePublic();

  // Return the public URL
  return file.publicUrl();
}


// async function uploadToS3(path, originalFilename, mimetype) {
//   const client = new S3Client({
//     region: process.env.S3_REGION,
//     credentials: {
//       accessKeyId: process.env.S3_ACCESS_KEY,
//       secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
//     },
//   });
//   const parts = originalFilename.split(".");
//   const ext = parts[parts.length - 1];
//   const newFilename = Date.now() + "." + ext;
//   await client.send(
//     new PutObjectCommand({
//       Bucket: bucket,
//       Body: fs.readFileSync(path),
//       Key: newFilename,
//       ContentType: mimetype,
//       ACL: "public-read",
//     })
//   );
//   return `https://${bucket}.s3.amazonaws.com/${newFilename}`;
// }

function getUserDataFromToken(req) {
  return new Promise((resolve, reject) => {
    jwt.verify(req.cookies.token, jwtSecret, {}, async (err, userData) => {
      if (err) throw err;
      resolve(userData);
    });
  });
}

app.get("/api/", (req, res) => {
  mongoose.connect(process.env.MONGO_URL);
  res.json("test ok");
});

app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const userDoc = await User.create({
      name,
      email,
      password: bcrypt.hashSync(password, bcryptSalt),
    });
    res.json(userDoc);
  } catch (e) {
    res.status(422).json(e); //422-> Unprocessable Entity
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const userDoc = await User.findOne({ email });
  if (userDoc) {
    const passOK = bcrypt.compareSync(password, userDoc.password);
    if (passOK) {
      jwt.sign(
        {
          email: userDoc.email,
          id: userDoc._id,
        },
        jwtSecret,
        {},
        (err, token) => {
          if (err) throw err;
          res.cookie("token", token).json(userDoc);
        }
      );
    } else {
      res.status(422).json("Password not match");
    }
  } else {
    res.status(422).json("not found");
  }
});

app.get("/api/profile", (req, res) => {
  const { token } = req.cookies;
  if (token) {
    jwt.verify(token, jwtSecret, {}, async (err, userData) => {
      if (err) throw err;
      const { name, email, _id } = await User.findById(userData.id);
      res.json({ name, email, _id });
    });
  } else {
    res.json(null);
  }
});

app.post("/api/logout", (req, res) => {
  res.cookie("token", "").json(true);
});

app.post("/api/upload-by-link", async (req, res) => {
  const { link } = req.body;
  const newName = "photo_" + Date.now() + ".jpg";
  await imageDownloader.image({
    url: link,
    dest: "/tmp/" + newName,
  });
  // const url = await uploadToS3(
  //   "/tmp/" + newName,
  //   newName,
  //   mime.lookup("/tmp/" + newName)
  // );
  const url = await uploadToFirebaseStorage(
    "/tmp/" + newName,
    newName,
    mime.lookup("/tmp/" + newName)
  );
  res.json(url);
});

const photosMiddleware = multer({ dest: "/tmp" });

app.post(
  "/api/upload",
  photosMiddleware.array("photos", 100),
  async (req, res) => {
    const uploadFiles = [];
    for (let i = 0; i < req.files.length; i++) {
      const { path, originalname, mimetype } = req.files[i];
      //const url = await uploadToS3(path, originalname, mimetype);
      const url = await uploadToFirebaseStorage(path, originalname, mimetype);
      uploadFiles.push(url);
    }
    res.json(uploadFiles);
  }
);

app.post("/api/places", (req, res) => {
  const { token } = req.cookies;
  const {
    title,
    address,
    addedPhotos,
    description,
    price,
    perks,
    extraInfo,
    checkIn,
    checkOut,
    maxGuests,
  } = req.body;
  jwt.verify(token, jwtSecret, {}, async (err, userData) => {
    if (err) throw err;
    const placeDoc = await Place.create({
      owner: userData.id,
      title,
      address,
      photos: addedPhotos,
      description,
      price,
      perks,
      extraInfo,
      checkIn,
      checkOut,
      maxGuests,
    });
    res.json(placeDoc);
  });
});

app.get("/api/user-places", (req, res) => {
  const { token } = req.cookies;
  jwt.verify(token, jwtSecret, {}, async (err, userData) => {
    const { id } = userData;
    res.json(await Place.find({ owner: id }));
  });
});

app.get("/api/places/:id", async (req, res) => {
  const { id } = req.params;
  res.json(await Place.findById(id));
});

app.put("/api/places", async (req, res) => {
  const { token } = req.cookies;
  const {
    id,
    title,
    address,
    addedPhotos,
    description,
    perks,
    extraInfo,
    checkIn,
    checkOut,
    maxGuests,
    price,
  } = req.body;

  jwt.verify(token, jwtSecret, {}, async (err, userData) => {
    if (err) throw err;
    const placeDoc = await Place.findById(id);
    if (userData.id === placeDoc.owner.toString()) {
      placeDoc.set({
        title,
        address,
        photos: addedPhotos,
        description,
        perks,
        extraInfo,
        checkIn,
        checkOut,
        maxGuests,
        price,
      });
      await placeDoc.save();
      res.json("ok");
    }
  });
});

app.get("/api/places", async (req, res) => {
  res.json(await Place.find());
});

app.post("/api/bookings", async (req, res) => {
  try {
    const userData = await getUserDataFromToken(req);
    const { place, checkIn, checkOut, numberOfGuests, name, phone, price } = req.body;

    const booking = await Booking.create({
      user: userData.id,
      place,
      checkIn,
      checkOut,
      numberOfGuests,
      name,
      phone,
      price,
    });

    res.json(booking);
  } catch (err) {
    console.error("Error creating booking:", err);
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/bookings", async (req, res) => {
  try {
    const userData = await getUserDataFromToken(req);
    const bookings = await Booking.find({ user: userData.id }).populate("place");
    res.json(bookings);
  } catch (err) {
    console.error("Error fetching bookings:", err);
    res.status(400).json({ error: err.message });
  }
});

