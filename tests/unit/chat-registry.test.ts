/**
 * Unit tests for the multi-group round-robin registry + command parser.
 *
 * Redis is forced OFF (CACHE_DRIVER=memory) so the in-memory fallback is under
 * test. resetRegistryForTests() runs up front and in afterAll for cross-file
 * isolation (the fallback state is module-global).
 */

// Env BEFORE imports (lib/env.ts reads process.env at import time).
process.env.DATABASE_URL = process.env.DATABASE_URL || "file:./test.sqlite";
process.env.CACHE_DRIVER = "memory";
process.env.TELEGRAM_SUPPORT_CHAT_ID = "-100ENVFALLBACK";

import { parseGroupCommand } from "@/lib/chat/telegram";
import {
  registerGroup,
  pauseGroup,
  removeGroup,
  listGroups,
  canDispatch,
  selectDispatchChatId,
  resetRegistryForTests,
} from "@/lib/chat/registry";

beforeEach(() => resetRegistryForTests());
afterAll(() => resetRegistryForTests());

describe("parseGroupCommand", () => {
  const cases: [string | undefined, ReturnType<typeof parseGroupCommand>][] = [
    ["/start", "start"],
    ["/start@SupportBot", "start"],
    ["/PAUSE", "pause"],
    ["  /end  ", "end"],
    ["/end extra args", "end"],
    ["/close", null],
    ["/other", null],
    ["hello there", null],
    ["", null],
    [undefined, null],
  ];
  for (const [input, expected] of cases) {
    it(`parses ${JSON.stringify(input)} -> ${expected}`, () => {
      expect(parseGroupCommand(input)).toBe(expected);
    });
  }
});

describe("round-robin registry lifecycle", () => {
  it("uses the env fallback before any group is registered", async () => {
    expect(await canDispatch()).toBe(true);
    const target = await selectDispatchChatId();
    expect(target).toEqual({ chatId: "-100ENVFALLBACK", disabled: false });
  });

  it("distributes new chats round-robin across registered groups", async () => {
    await registerGroup("111", "Alpha");
    await registerGroup("222", "Beta");

    const picks: (string | null)[] = [];
    for (let i = 0; i < 4; i++) picks.push((await selectDispatchChatId()).chatId);
    // stableSort orders by registeredAt then chatId; "111" < "222".
    expect(picks).toEqual(["111", "222", "111", "222"]);
  });

  it("pause skips a group for NEW chats but keeps it listed", async () => {
    await registerGroup("111", "Alpha");
    await registerGroup("222", "Beta");
    await pauseGroup("111");

    expect((await listGroups()).length).toBe(2); // still listed
    const picks = [
      (await selectDispatchChatId()).chatId,
      (await selectDispatchChatId()).chatId,
    ];
    expect(picks).toEqual(["222", "222"]); // only the active group
  });

  it("re-registering a paused group unpauses it", async () => {
    await registerGroup("111", "Alpha");
    await registerGroup("222", "Beta");
    await pauseGroup("111");
    await registerGroup("111"); // unpause, preserves registeredAt/title

    const group = (await listGroups()).find((g) => g.chatId === "111");
    expect(group?.paused).toBe(false);
    expect(group?.title).toBe("Alpha"); // title preserved
  });

  it("disables chat once initialized and emptied, even with an env fallback set", async () => {
    await registerGroup("111", "Alpha");
    await registerGroup("222", "Beta");
    await removeGroup("111");
    await removeGroup("222");

    expect(await listGroups()).toHaveLength(0);
    expect(await canDispatch()).toBe(false);
    const target = await selectDispatchChatId();
    expect(target.disabled).toBe(true);
    expect(target.chatId).toBeNull();
  });
});
