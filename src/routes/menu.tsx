import { createFileRoute, Link } from "@tanstack/react-router";
import { BellRing, Bot, Brain, Gamepad2, Home, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/menu")({ component: MainMenu });

const items = [
  { to: "/", title: "Tracker dashboard", copy: "Manage X, Roblox, price and website monitoring.", icon: Home },
  { to: "/bot-connections", title: "Bot connections", copy: "View Discord, Roblox, X and database health.", icon: Bot },
  { to: "/private-alerts", title: "Discord DM setup", copy: "Configure your bot token, user ID and test private DMs.", icon: BellRing },
  { to: "/puzzle-solver", title: "Puzzle lab", copy: "Solve image grids, compare candidates, correct tiles and train the matcher.", icon: Brain },
];

function MainMenu() {
  return <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6"><div className="mx-auto max-w-5xl space-y-6">
    <Card className="tracker-card p-6 sm:p-8"><p className="eyebrow"><span /> AMBUNCTIOUS CONTROL CENTRE</p><div className="mt-3 flex items-start gap-4"><div className="tracker-avatar"><ShieldCheck /></div><div><h1 className="text-3xl font-semibold">Main menu</h1><p className="mt-2 text-sm text-muted-foreground">Everything for monitoring, Discord alerts, connection health and puzzle solving in one place.</p></div></div></Card>
    <section className="grid gap-4 sm:grid-cols-2">{items.map((item) => { const Icon = item.icon; return <Link key={item.to} to={item.to} className="block"><Card className="tracker-card h-full p-5 transition hover:-translate-y-0.5 hover:border-primary/50"><div className="flex items-start gap-4"><div className="tracker-avatar"><Icon /></div><div><h2 className="text-lg font-semibold">{item.title}</h2><p className="mt-2 text-sm text-muted-foreground">{item.copy}</p></div></div></Card></Link>; })}</section>
    <Card className="content-panel flex items-center gap-3 p-4 text-sm text-muted-foreground"><Gamepad2 size={18} /> The tracker continues running in the background while you use any page.</Card>
  </div></main>;
}
