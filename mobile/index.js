import Sentry from './sentry';
import {AppRegistry} from 'react-native';
import App from './App';

// Must match MainActivity#getMainComponentName().
AppRegistry.registerComponent('ZaycommMobile', () => Sentry.wrap(App));
