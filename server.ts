import { Application, S3Client, decode, Router, ListObjectsCommand, path, GetObjectCommand, getSignedUrl, DateTime } from './deps.ts';

const BASIC_AUTH = Deno.env.get("BASIC_AUTH") ?? "no:pass";
const B2_ACCOUNT_ID = Deno.env.get("B2_ACCOUNT_ID") ?? "0";
const B2_APPLICATION_KEY = Deno.env.get("B2_APPLICATION_KEY") ?? "0";
const B2_REGION = Deno.env.get("B2_REGION") ?? "us-east-005";
const B2_ENDPOINT = `https://s3.${B2_REGION}.backblazeb2.com`;
const B2_BUCKET_NAME = Deno.env.get("B2_BUCKET_NAME") ?? "bucket";
const DIRECTORY_PATH = Deno.env.get("B2_DIRECTORY_PATH") ?? "/";

const app = new Application();

const s3 = new S3Client({
  endpoint: B2_ENDPOINT,
  region: B2_REGION,
  credentials: {
    accessKeyId: B2_ACCOUNT_ID,
    secretAccessKey: B2_APPLICATION_KEY,
  },
});

// Basic auth
app.use(async (ctx, next) => {
  const auth = ctx.request.headers.get("Authorization");

  if (auth?.startsWith("Basic")) {
    const str = auth?.split(/\s+/).at(1);

    if (str && (new TextDecoder().decode(decode(str)) === BASIC_AUTH)) {
      return await next();
    }
  }

  ctx.response.status = 401;
  ctx.response.headers.set("WWW-Authenticate", 'Basic realm="MC Backups"');
});

// Logger
app.use(async (ctx, next) => {
  await next();
  const rt = ctx.response.headers.get("X-Response-Time");
  console.log(`${ctx.request.method} ${ctx.request.url} - ${rt}`);
});

// Timing
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  ctx.response.headers.set("X-Response-Time", `${ms}ms`);
});

const router = new Router();
router
  .get("/", async (ctx) => {
    const { response } = ctx;
    try {
      const data = await s3.send(
        new ListObjectsCommand({
          Bucket: B2_BUCKET_NAME,
          Prefix: DIRECTORY_PATH,
        }),
      );

      const contents = data.Contents ?? [];

      const validContents = contents.filter((_object) => {
        return !!_object.Key;
      });

      const tableRows = validContents.map((_object) => {
        const fileSize = formatFileSize(_object.Size);
        const lastModified = formatDate(_object.LastModified);

        const fileName = path.basename(_object.Key || "/missing");

        return `
        <tr>
          <td><a href="/download/${fileName}">${fileName}</a></td>
          <td>${fileSize}</td>
          <td>${lastModified}</td>
        </tr>
      `;
      });

      const htmlResponse = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>File List</title>
      </head>
      <body>
        <main>
        <h1>Suhvuh Backups</h1>
        <table class="wide-table">
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>Last Modified</th>
          </tr>
          ${tableRows.join("\n")}
        </table>
        </main>
      </body>
      <style>
        body {
          width: 100%;
          height: 100%;
          
          background-color: #121212;
          color: white;
          
          font-family: sans-serif;
        }

        main {
          margin: 4rem;
        }
        
        th {
          text-align: left;
        }
        
        table, td, th {
          border: 1px solid;
        }

        .wide-table {
          width: 100%;
        }
      </style>
      </html>
    `;

      response.headers.set("Content-Type", "text/html");
      response.body = htmlResponse;
    } catch (error) {
      response.body = `Error: ${error.message}`;
    }
  })
  .get("/download/:filename", async (context) => {
    const { response } = context;
    const { filename } = context.params;

    try {
      const getCommand = new GetObjectCommand({
        Bucket: B2_BUCKET_NAME,
        Key: `${DIRECTORY_PATH}/${filename}`,
      });

      const signedUrl = await getSignedUrl(s3, getCommand, { expiresIn: 3600 });
      response.redirect(signedUrl);
    } catch (error) {
      response.body = `Error: ${error.message}`;
    }
  })
  .get("/(.*)", (context) => {
    context.response.status = 404;
    context.response.body = "Not Found";
  });

app.use(router.routes());
app.use(router.allowedMethods());

function formatFileSize(size?: number): string {
  if (!size) return "unknown";

  if (size < 1024) {
    return `${size} bytes`;
  } else if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(2)} KiB`;
  } else if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(2)} MiB`;
  } else {
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  }
}

function formatDate(timestamp?: Date): string {
  if (!timestamp) return "unknown";

  const dt = DateTime.fromJSDate(timestamp);

  return dt.toLocal().toLocaleString(DateTime.DATETIME_FULL);
}

function mustHandle(_req: Request) {
  return new Promise<Response>((resolve, reject) => {
    app.handle(_req).then((resp) => resolve(resp || new Response("Undefined response")))
      .catch((error) => reject(error));
  });
}

Deno.serve((_req) => mustHandle(_req));
