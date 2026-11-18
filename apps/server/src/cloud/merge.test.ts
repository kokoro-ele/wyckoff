import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase } from "../db/schema.js";
import { mergeWorkspaceChanges } from "./merge.js";

const open: Database.Database[] = [];
function fresh(from?: Buffer): Database.Database {
  const database = new Database(from ?? ":memory:");
  initializeDatabase(database);
  open.push(database);
  return database;
}
afterEach(() => open.splice(0).forEach((database) => database.close()));

function addSession(database: Database.Database, id: string, title: string) {
  database
    .prepare("INSERT INTO sessions (id, symbol, period, title, created_at, updated_at) VALUES (?, 'AAPL.US', '1d', ?, 1, 1)")
    .run(id, title);
}
function addMessage(database: Database.Database, id: string, sessionId: string, content: string) {
  database
    .prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, 1)")
    .run(id, sessionId, content);
}

describe("mergeWorkspaceChanges", () => {
  it("replays a long job's rows onto a newer snapshot without losing the concurrent write", () => {
    const base = fresh();
    addSession(base, "s1", "first");
    const snapshot = base.serialize();

    // The analysis started from `snapshot` and appended a message.
    const changed = fresh(snapshot);
    addMessage(changed, "m1", "s1", "analysis result");

    // Meanwhile the user renamed a session and saved a setting.
    const latest = fresh(snapshot);
    latest.prepare("UPDATE sessions SET title='renamed' WHERE id='s1'").run();
    latest.prepare("INSERT INTO app_state(key,value) VALUES('theme','dark')").run();

    mergeWorkspaceChanges(fresh(snapshot), changed, latest);

    expect(latest.prepare("SELECT title FROM sessions WHERE id='s1'").get()).toEqual({ title: "renamed" });
    expect(latest.prepare("SELECT content FROM messages WHERE id='m1'").get()).toEqual({ content: "analysis result" });
    expect(latest.prepare("SELECT value FROM app_state WHERE key='theme'").get()).toEqual({ value: "dark" });
  });

  it("replays deletions and lets the job win when both sides changed the same row", () => {
    const base = fresh();
    addSession(base, "s1", "first");
    addSession(base, "s2", "second");
    const snapshot = base.serialize();

    const changed = fresh(snapshot);
    changed.prepare("DELETE FROM sessions WHERE id='s2'").run();
    changed.prepare("UPDATE sessions SET title='from job' WHERE id='s1'").run();

    const latest = fresh(snapshot);
    latest.prepare("UPDATE sessions SET title='from user' WHERE id='s1'").run();

    const stats = mergeWorkspaceChanges(fresh(snapshot), changed, latest);
    expect(stats.deleted).toBe(1);
    expect(latest.prepare("SELECT id, title FROM sessions ORDER BY id").all()).toEqual([{ id: "s1", title: "from job" }]);
  });

  it("drops a job's child row when the user deleted its parent meanwhile", () => {
    const base = fresh();
    addSession(base, "s1", "first");
    const snapshot = base.serialize();

    const changed = fresh(snapshot);
    addMessage(changed, "m1", "s1", "late answer");

    const latest = fresh(snapshot);
    latest.prepare("DELETE FROM sessions WHERE id='s1'").run();

    const stats = mergeWorkspaceChanges(fresh(snapshot), changed, latest);
    expect(stats.skipped).toBe(1);
    expect(latest.prepare("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 0 });
    expect(latest.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  it("does not touch rows the job left unchanged", () => {
    const base = fresh();
    addSession(base, "s1", "first");
    const snapshot = base.serialize();
    const changed = fresh(snapshot);
    const latest = fresh(snapshot);
    latest.prepare("UPDATE sessions SET title='user edit' WHERE id='s1'").run();

    const stats = mergeWorkspaceChanges(fresh(snapshot), changed, latest);
    expect(stats).toEqual({ upserted: 0, deleted: 0, skipped: 0 });
    expect(latest.prepare("SELECT title FROM sessions").get()).toEqual({ title: "user edit" });
  });
});
