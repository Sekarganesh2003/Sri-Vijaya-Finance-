import { bootstrapApplication } from '@angular/platform-browser';
import { provideClientHydration } from '@angular/platform-browser';
import { App } from './app/app';

bootstrapApplication(App, {
  providers: [provideClientHydration()],
}).catch((error) => console.error(error));
