import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './theme.service';

@Component({
  selector: 'pj-admin-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AdminRoot {
  readonly theme = inject(ThemeService);
}
