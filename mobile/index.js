import 'react-native-get-random-values';
import Sentry from './sentry';
import {AppRegistry} from 'react-native';
import App from './AppV2';

// Must match MainActivity#getMainComponentName().
AppRegistry.registerComponent('ZaycommMobile', () => Sentry.wrap(App));
