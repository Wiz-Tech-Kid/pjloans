import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

type Theme = 'dark' | 'light';
const THEME_KEY = 'pjloans-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  readonly theme = signal<Theme>(this.initialTheme());

  constructor() {
    this.apply(this.theme());
  }

  toggle(): void {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    this.document.defaultView?.localStorage.setItem(THEME_KEY, next);
    this.apply(next);
  }

  private initialTheme(): Theme {
    const saved = this.document.defaultView?.localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    const view = this.document.defaultView;
    return view && typeof view.matchMedia === 'function' && view.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  private apply(theme: Theme): void {
    this.document.documentElement.dataset['theme'] = theme;
    this.document.documentElement.style.colorScheme = theme;
  }
}
