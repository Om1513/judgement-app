// The lobby player list row. The remove control is the part that matters: it
// must appear for the host looking at someone else, and never otherwise.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

import PlayerCard from "../PlayerCard";

const human = { id: "p2", name: "Riya", isHost: false, isBot: false };
const host = { id: "p1", name: "Omkar", isHost: true, isBot: false };
const bot = { id: "b1", name: "Judge", isHost: false, isBot: true };

describe("PlayerCard", () => {
  it("shows the player name", () => {
    render(<PlayerCard player={human} />);
    expect(screen.getByText("Riya")).toBeTruthy();
  });

  it("badges the host", () => {
    render(<PlayerCard player={host} />);
    expect(screen.getByText("HOST")).toBeTruthy();
  });

  it("does not badge a non-host", () => {
    render(<PlayerCard player={human} />);
    expect(screen.queryByText("HOST")).toBeNull();
  });

  it("marks a bot with an avatar of its own", () => {
    render(<PlayerCard player={bot} />);
    expect(screen.getByText("🤖")).toBeTruthy();
  });

  it("uses the initial as the avatar for a human", () => {
    render(<PlayerCard player={human} />);
    expect(screen.getByText("R")).toBeTruthy();
  });

  it("survives a player with no name", () => {
    render(<PlayerCard player={{ id: "x", name: "" }} />);
    expect(screen.getByText("?")).toBeTruthy();
  });
});

describe("a player who has dropped out", () => {
  const away = { ...human, connected: false };

  it("is still shown, with the same name and avatar", () => {
    render(<PlayerCard player={away} />);

    expect(screen.getByText("Riya")).toBeTruthy();
    expect(screen.getByText("R")).toBeTruthy();
  });

  it("is labelled as reconnecting", () => {
    render(<PlayerCard player={away} />);
    expect(screen.getByText("RECONNECTING...")).toBeTruthy();
  });

  it("is not labelled while connected", () => {
    render(<PlayerCard player={{ ...human, connected: true }} />);
    expect(screen.queryByText("RECONNECTING...")).toBeNull();
  });

  it("is not labelled when the caller does not track presence", () => {
    render(<PlayerCard player={human} />);
    expect(screen.queryByText("RECONNECTING...")).toBeNull();
  });

  it("keeps the host badge, so the seat still reads as the host's", () => {
    render(<PlayerCard player={{ ...host, connected: false }} />);

    expect(screen.getByText("HOST")).toBeTruthy();
    expect(screen.getByText("RECONNECTING...")).toBeTruthy();
  });

  it("can still be removed by the host", () => {
    const onRemove = jest.fn();
    render(<PlayerCard player={away} canRemove onRemove={onRemove} />);

    fireEvent.press(screen.getByText("X"));

    expect(onRemove).toHaveBeenCalledWith(away);
  });

  it("never applies to a bot, which has no connection to lose", () => {
    render(<PlayerCard player={{ ...bot, connected: false }} />);

    expect(screen.queryByText("RECONNECTING...")).toBeNull();
    expect(screen.getByText("BOT")).toBeTruthy();
  });
});

describe("the remove control", () => {
  it("is hidden when the viewer cannot remove anyone", () => {
    render(<PlayerCard player={human} canRemove={false} onRemove={() => {}} />);
    expect(screen.queryByText("X")).toBeNull();
  });

  it("is shown to a host looking at another player", () => {
    render(<PlayerCard player={human} canRemove onRemove={() => {}} />);
    expect(screen.getByText("X")).toBeTruthy();
  });

  it("is never shown against the host themselves", () => {
    render(<PlayerCard player={host} canRemove onRemove={() => {}} />);
    expect(screen.queryByText("X")).toBeNull();
  });

  it("is shown for a bot, so bots can be removed like anyone else", () => {
    render(<PlayerCard player={bot} canRemove onRemove={() => {}} />);
    expect(screen.getByText("X")).toBeTruthy();
  });

  it("passes the player back when tapped", () => {
    const onRemove = jest.fn();
    render(<PlayerCard player={human} canRemove onRemove={onRemove} />);

    fireEvent.press(screen.getByText("X"));

    expect(onRemove).toHaveBeenCalledWith(human);
  });
});
