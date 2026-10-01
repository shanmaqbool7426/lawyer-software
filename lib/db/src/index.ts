import mongoose from "mongoose";

const DATABASE_URL = process.env.DATABASE_URL;

export async function connectDatabase(): Promise<void> {
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Provide it via the environment (e.g. DATABASE_URL=mongodb+srv://...) instead of hardcoding credentials.",
    );
  }
  await mongoose.connect(DATABASE_URL, {
    serverSelectionTimeoutMS: 15000,
  });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export * from "./schema";