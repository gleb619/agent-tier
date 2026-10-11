import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import Badge from "../components/common/Badge.svelte";
import Button from "../components/common/Button.svelte";
import Card from "../components/common/Card.svelte";
import Input from "../components/common/Input.svelte";
import Select from "../components/common/Select.svelte";
import Separator from "../components/common/Separator.svelte";
import Toggle from "../components/common/Toggle.svelte";
import Tooltip from "../components/common/Tooltip.svelte";

describe("Button", () => {
  it("renders its label and fires click", async () => {
    const onClick = vi.fn();
    render(Button, { label: "Save", onClick });
    const button = screen.getByRole("button", { name: "Save" });
    await fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("supports variants and is disabled when asked", () => {
    render(Button, { label: "Delete", variant: "danger", disabled: true });
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toBeDisabled();
    expect(button.className).toContain("bg-error");
  });
});

describe("Input", () => {
  it("renders label + input bound to value", async () => {
    render(Input, { id: "prompt", label: "Prompt", placeholder: "type here", value: "" });
    const input = screen.getByLabelText("Prompt");
    expect(input).toHaveAttribute("placeholder", "type here");
    await fireEvent.input(input, { target: { value: "hello" } });
    expect(input).toHaveValue("hello");
  });
});

describe("Select", () => {
  it("renders options and reflects selection", async () => {
    const options = [
      { value: "all", label: "All" },
      { value: "done", label: "Done" },
    ];
    render(Select, { id: "status", label: "Status", options, value: "all" });
    const select = screen.getByLabelText("Status");
    expect(select).toHaveValue("all");
    await fireEvent.change(select, { target: { value: "done" } });
    expect(select).toHaveValue("done");
  });
});

describe("Toggle", () => {
  it("toggles checked state with role=switch", async () => {
    render(Toggle, { label: "Auto refresh", checked: false });
    const toggle = screen.getByRole("switch", { name: "Auto refresh" });
    expect(toggle).not.toBeChecked();
    await fireEvent.click(toggle);
    expect(toggle).toBeChecked();
  });
});

describe("Card", () => {
  it("renders title and slot content", () => {
    render(Card, { title: "Session" });
    expect(screen.getByText("Session")).toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("renders colored badge content", () => {
    render(Badge, { color: "green", text: "running" });
    const badge = screen.getByText("running");
    expect(badge.className).toContain("bg-green-100");
  });
});

describe("Separator", () => {
  it("renders a horizontal rule", () => {
    render(Separator);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });
});

describe("Tooltip", () => {
  it("exposes tooltip text for its trigger", () => {
    render(Tooltip, { text: "Shortcut: 1" });
    expect(screen.getByText("Shortcut: 1")).toBeInTheDocument();
  });
});
