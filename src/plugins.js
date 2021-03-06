import fetch from "node-fetch";

function replaceAll(str, find, replace) {
  return str.replace(new RegExp(find, "g"), replace);
}

export function getScopedImport(importMap, importer, name) {
  for (const [scope, modules] of Object.entries(importMap.scopes)) {
    if (importer.startsWith(scope)) {
      for (const [module, importPath] of Object.entries(modules)) {
        if (name === module) {
          return importPath;
        }
      }
    }
  }
}


export const http = function (importMap) {
  return {
    name: "http",
    setup(build) {


      // For every import map, make sure we resolve to the absolute url
      for (const [name, url] of Object.entries(importMap.imports)) {
        build.onResolve({ filter: new RegExp(`^${name}$`, "i") }, (args) => {
          // console.log("YES", name, url, args)
          return {
            path: url,
            namespace: "http-url",
          }
        })
      }


      // Intercept import paths starting with "http:" and "https:" so
      // esbuild doesn't attempt to map them to a file system location.
      // Tag them with the "http-url" namespace to associate them with
      // this plugin.
      build.onResolve({ filter: /^https?:\/\// }, (args) => ({
        path: args.path,
        namespace: "http-url",
      }));

      // We also want to intercept all import paths inside downloaded
      // files and resolve them against the original URL. All of these
      // files will be in the "http-url" namespace. Make sure to keep
      // the newly resolved URL in the "http-url" namespace so imports
      // inside it will also be resolved as URLs recursively.
      build.onResolve({ filter: /.*/, namespace: "http-url" }, (args) => {
        return {
          path: getScopedImport(importMap, args.importer, args.path) || importMap.imports[args.path] ||
            new URL(args.path, args.importer).toString(),
          namespace: "http-url",
        }
      })

      // When a URL is loaded, we want to actually download the content
      // from the internet. This has just enough logic to be able to
      // handle the example import from unpkg.com but in reality this
      // would probably need to be more complex.
      build.onLoad({ filter: /.*/, namespace: "http-url" }, async (args) => {
        async function fetchUrl(url) {

          if (importMap.imports[url]) {
            url = importMap.imports[url]
          }

          const response = await fetch(url);
          if (response.status === 200) {
            if (
              !url.endsWith(".js") &&
              response.headers.get("content-type").indexOf("text/html") !== -1
            ) {
              return fetchUrl(`${url}.js`);
            } else {
              return [response.url, await response.text()];
            }
          } else {
            throw new Error(`GET ${url} failed: status ${response.status}`);
          }
        }

        let [url, contents] = await fetchUrl(args.path);

        if (!contents || typeof contents !== "string") {
          throw new Error(
            `esbuild.http: no contents received for ${url} "${contents}"`
          );
        }

        // We patch the contents with the esm import.meta api
        contents = replaceAll(contents, "import.meta", JSON.stringify({ url }));

        return { contents };
      });
    },
  }
}
