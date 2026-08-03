"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { type ComponentProps } from "react";
import ClientOnly from "./client-only";
import Image from "next/image";
import light from "../public/images/switch/sun-01.svg";
import dark from "../public/images/switch/vector.svg";

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const toggleTheme = (event: React.MouseEvent<HTMLButtonElement>) => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const newMode = theme === "light" ? "dark" : "light";

    if (!document.startViewTransition || prefersReducedMotion) {
      setTheme(newMode);
      return;
    }

    const { clientX: x, clientY: y } = event;
    const root = document.documentElement;

    root.style.setProperty("--x", `${x}px`);
    root.style.setProperty("--y", `${y}px`);

    document.startViewTransition(() => {
      setTheme(newMode);
    });
  };

  return (
    <ClientOnly>
      <div id="my_switcher" className={`my_switcher position-static`}>
        <ul>
          {theme === "dark" ? (
            <li>
              <button
                data-theme="light"
                className="setColor light bg-blackest"
                onClick={toggleTheme}
              >
                <Image src={dark} alt="Sun images" />
              </button>
            </li>
          ) : (
            <li>
              <button
                data-theme="dark"
                className="setColor dark bg-blackest"
                onClick={toggleTheme}
              >
                <Image src={light} alt="Vector Images" />
              </button>
            </li>
          )}
        </ul>
      </div>
    </ClientOnly>
  );
}
