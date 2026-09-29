declare const __RIPE_BUILD_ID__: string;

export const BUILD_ID = typeof __RIPE_BUILD_ID__ === 'string' ? __RIPE_BUILD_ID__ : 'development';
