import { bootstrapApplication } from '@angular/platform-browser';
import { provideServerRendering } from '@angular/platform-server';
import { App } from './app/app';

export default bootstrapApplication(App, {
  providers: [provideServerRendering()],
});
