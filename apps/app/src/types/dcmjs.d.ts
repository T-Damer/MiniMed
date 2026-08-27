declare module 'dcmjs' {
  interface DcmjsLogger {
    setLevel(level: 'silent'): void;
  }

  const dcmjs: {
    readonly log: {
      getLogger(name: string): DcmjsLogger;
    };
  };

  export default dcmjs;
}
