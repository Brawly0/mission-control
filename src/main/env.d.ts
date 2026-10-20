/** electron-vite builds `?modulePath` imports as separate entry files and returns their path. */
declare module '*?modulePath' {
  const path: string
  export default path
}
