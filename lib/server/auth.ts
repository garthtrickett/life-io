// lib/server/auth.ts
import { TimeSpan, createDate } from "oslo";
import { alphabet, generateRandomString } from "oslo/crypto";
import { Argon2id } from "oslo/password";
import { db } from "../../db/kysely";
import type { User } from "../../types/generated/public/User";
import type { SessionId } from "../../types/generated/public/Session";
import type { UserId } from "../../types/generated/public/User";

export const argon2id = new Argon2id();

export const createSession = async (userId: string) => {
  const sessionId = generateRandomString(40, alphabet("a-z", "0-9"));
  const expiresAt = createDate(new TimeSpan(30, "d"));

  await db
    .insertInto("session")
    .values({
      id: sessionId as SessionId,
      user_id: userId as UserId,
      expires_at: expiresAt,
    })
    .execute();

  return sessionId;
};

export const deleteSession = async (sessionId: string) => {
  await db
    .deleteFrom("session")
    .where("id", "=", sessionId as SessionId)
    .execute();
};

export const validateSession = async (
  sessionId: string,
): Promise<{ user: User | null; session: { id: string } | null }> => {
  const session = await db
    .selectFrom("session")
    .selectAll()
    .where("id", "=", sessionId as SessionId)
    .executeTakeFirst();

  if (!session || session.expires_at < new Date()) {
    return { user: null, session: null };
  }

  const user = await db
    .selectFrom("user")
    .selectAll()
    .where("id", "=", session.user_id)
    .executeTakeFirst();

  if (!user) {
    return { user: null, session: null };
  }

  return { user, session: { id: session.id } };
};
