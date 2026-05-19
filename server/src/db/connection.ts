// Database connection using Prisma

import { PrismaClient } from '@prisma/client';

// Singleton pattern for Prisma client
let prisma: PrismaClient;

export function getDB(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }
  return prisma;
}

export async function connectDB(): Promise<void> {
  const db = getDB();
  try {
    await db.$connect();
    console.log('Database connected successfully');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    throw error;
  }
}

export async function disconnectDB(): Promise<void> {
  const db = getDB();
  await db.$disconnect();
  console.log('Database disconnected');
}

// Export the prisma instance for direct use
export { prisma };
