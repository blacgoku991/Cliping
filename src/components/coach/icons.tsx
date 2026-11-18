import { CalendarClock, Hash, Layers, MessageCircle, Rocket, Scale, Timer, Type, UserRound, Users, Zap, type LucideIcon } from "lucide-react";
import type { GuideTheme } from "@/lib/coach/guide";

export const THEME_ICONS: Record<GuideTheme["icon"], LucideIcon> = {
  hook: Zap,
  clock: Timer,
  title: Type,
  hash: Hash,
  calendar: CalendarClock,
  comment: MessageCircle,
  profile: UserRound,
  series: Layers,
  accounts: Users,
  rights: Scale,
  launch: Rocket,
};
