declare module 'gifenc' {
  interface FrameOptions {
    palette?: number[][]
    delay?: number
    transparent?: boolean
    transparentIndex?: number
    repeat?: number
  }
  interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: FrameOptions): void
    finish(): void
    bytes(): Uint8Array
  }
  const gifenc: { GIFEncoder(opts?: { auto?: boolean }): Encoder }
  export default gifenc
}
