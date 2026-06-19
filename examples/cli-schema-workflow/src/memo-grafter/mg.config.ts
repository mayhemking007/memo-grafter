declare const process: {
  env: {
    DATABASE_URL?: string;
  };
};

export default {
  db: {
    connectionString: process.env.DATABASE_URL,
  },
};
