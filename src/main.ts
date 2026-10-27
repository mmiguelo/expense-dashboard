import './styles.css';
import { LocalStorageRepository } from './storage/localStorageRepository';
import { startApp } from './ui/app';

void startApp({ doc: document, repo: new LocalStorageRepository() });
