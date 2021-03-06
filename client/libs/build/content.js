const path = require('path');
const _ = require('lodash');
const fs = require('fs');
const frontMatter = require('front-matter');
const truncate = require('truncate-html');
const moment = require('moment');
const ejs = require('ejs');

const marked = require('./markdown');
const templates = require('./templates');
const applyHtmlPaths = require('./html_paths');
const file = require('./file');
const utils = require('./utils');
const log = require('./log');

const ignoreFiles     = ['.DS_Store'];

// -----------------------------------------------------------------------------
// Generate the output file name and path
// -----------------------------------------------------------------------------
function outFilePath(page, outputPath, inputFilePath, originalInputPath) {
  let out = path.join(outputPath, inputFilePath.replace(originalInputPath, ''));
  if (page && page.destination && page.destination.length > 0) {
    if (_.endsWith(page.destination, '/')) {
      out = path.join(outputPath, page.destination, 'index.html');
    } else {
      out = path.join(outputPath, page.destination);
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// build a single file
// -----------------------------------------------------------------------------
function buildContent(fullPath, app, webpackAssets, ext) {
  const content = fs.readFileSync(fullPath, 'utf8');
  const parsed = frontMatter(content);
  const metadata = parsed.attributes;
  const pathResult = utils.filename2date(fullPath);
  const date = moment(new Date(pathResult.date || fs.statSync(fullPath).ctime));
  const title = metadata.title || pathResult.title;
  const destination = metadata.permalink || pathResult.path || '/';

  const data = _.merge({
    _,
    date,
    title,
    moment,
    metadata,
    url: destination
  }, app.templateData);

  let html = parsed.body;

  try {
    // Allow ejs code in content
    html = ejs.compile(html, {
      cache: false,
      filename: fullPath
    })(data);

    // Parse any markdown in the resulting html
    if (_.includes(app.htmlOptions.markdownExtensions, ext)) {
      html = marked(html);
    }
  } catch (err) {
    log.error(`Unable to compile html from ${fullPath}`);
    // Uncomment the following for more details
    // log.error(err);
    // log.error('Call stack');
    // log.error(err.stack);
  }

  // Generate summary of content
  const summary  = _.includes(html, app.htmlOptions.summaryMarker) ?
    html.split(app.htmlOptions.summaryMarker)[0] :
    truncate(html, app.htmlOptions.truncateSummaryAt, { keepImageTag: true });

  // Apply template
  data.content = html; // Pass in generated html
  html = templates.apply(data,
    fullPath,
    app.templateMap,
    app.templateDirs);
  html = applyHtmlPaths(fullPath, html, app.production, webpackAssets, app.buildSuffix);

  return {
    title,
    date,
    metadata,
    summary,
    destination,
    html,
    source : fullPath,
    url    : destination
  };

}

// -----------------------------------------------------------------------------
// responsible for writing out html content after it's built or copying static files
// -----------------------------------------------------------------------------
function writeContent(
  inputFilePath,
  webpackAssets,
  app) {
  const ext = path.extname(inputFilePath);
  if (_.includes(app.htmlOptions.buildExtensions, ext)) {
    const page = buildContent(
      inputFilePath,
      app,
      webpackAssets,
      ext);
    const out = outFilePath(page, app.outputPath, inputFilePath, app.htmlPath);
    log.replace(`Writing ${inputFilePath} to: ${out}`);
    page.outputFilePath = file.write(out, page.html);
    return page;
  }
  const out = outFilePath(null, app.outputPath, inputFilePath, app.htmlPath);
  log.replace(`Copying ${inputFilePath} to: ${out}`);
  file.copy(inputFilePath, out);
  return null;
}

// -----------------------------------------------------------------------------
// build html and markdown files in a given directory
// -----------------------------------------------------------------------------
function buildContents(
  inputPath,
  app,
  webpackAssets) {

  let results = [];

  if (_.isEmpty(inputPath) || !fs.existsSync(inputPath)) {
    return results;
  }

  const files = fs.readdirSync(inputPath);

  files.forEach((fileName) => {
    const inputFilePath = path.join(inputPath, fileName);

    // Ignore template dirs
    const doOutput = app.templateDirs.indexOf(inputFilePath) < 0 &&
                  !_.includes(ignoreFiles, fileName);
    if (doOutput) {
      if (fs.statSync(inputFilePath).isDirectory()) {
        results = _.concat(results, buildContents(
          inputFilePath,
          app,
          webpackAssets
        ));
      } else {
        const page = writeContent(
          inputFilePath,
          webpackAssets,
          app);
        if (page) {
          results.push(page);
        }
      }
    }
  });
  log.out('');
  return results;
}

module.exports = {
  buildContents,
  writeContent
};
