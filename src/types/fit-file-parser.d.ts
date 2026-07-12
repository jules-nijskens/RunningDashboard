declare module 'fit-file-parser' {
  export interface FitParserOptions {
    force?: boolean;
    speedUnit?: 'km/h' | 'mph' | 'm/s';
    lengthUnit?: 'km' | 'mi' | 'm';
    temperatureUnit?: 'c' | 'f';
    elapsedRecordField?: boolean;
    mode?: 'cascade' | 'list' | 'both';
  }

  export default class FitParser {
    constructor(options?: FitParserOptions);
    parse(
      buffer: Buffer | ArrayBuffer,
      callback: (error: string | null, data: any) => void
    ): void;
  }
}
