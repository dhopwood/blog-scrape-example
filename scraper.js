const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const he = require('he');
const https = require('https');
const http = require('http');

// list of blog URLs
const blogUrls = [
  'https://your-site.com',
  'https://your-site.com',
  'https://your-site.com',
  'https://your-site.com',
];

// array of objects
// each object is the url the old site uses, and the updated url
// use this to compare and update
const blogUrlsSwap = [
  {oldurl: "https://your-old-site-url.com", newurl: "https://your-new-site-url.com"},
  {oldurl: "https://your-old-site-url.com", newurl: "https://your-new-site-url.com"},
  {oldurl: "https://your-old-site-url.com", newurl: "https://your-new-site-url.com"},
  {oldurl: "https://your-old-site-url.com", newurl: "https://your-new-site-url.com"},
];

// make blog folders where we will be writing to
const outputDir = path.join(__dirname, 'blog');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}
fs.mkdirSync('blog/images/', { recursive: true });

// function to download image
async function downloadImage(imageUrl, localPath) {
  return new Promise((resolve, reject) => {
    const protocol = imageUrl.startsWith('https:') ? https : http;
    
    const file = fs.createWriteStream(localPath);
    const request = protocol.get(imageUrl, (response) => {
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(localPath, () => {}); 
        reject(new Error(`Failed to download image: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
      
      file.on('error', (err) => {
        file.close();
        fs.unlink(localPath, () => {}); // Delete the file async
        reject(err);
      });
    }).on('error', (err) => {
      file.close();
      fs.unlink(localPath, () => {}); // Delete the file async
      reject(err);
    });
    
    request.setTimeout(10000, () => {
      request.destroy();
      file.close();
      fs.unlink(localPath, () => {});
      reject(new Error('Download timeout'));
    });
  });
}

// function to clean blog content
// remove classes & style attributes
// remove all data- attributes
// remove child spans inside of text elements
// remove aria level
// remove random empty P tags
async function cleanBlogContent($, $root, currentPageSlug) {
  $root.find('[class]').removeAttr('class');
  $root.find('[style]').removeAttr('style');

  $root.find('*').each((_, el) => {
    for (const attr of Object.keys(el.attribs || {})) {
      if (attr.startsWith('data-')) {
        delete el.attribs[attr];
      }
      if (attr.startsWith('aria-level')) {
        delete el.attribs[attr];
      }
    }
  });

  const textElements = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption';
  let changed = true;
  while (changed) {
    changed = false;
    $root.find(textElements).find('span').each((_, el) => {
      const $el = $(el);
      $el.replaceWith($el.contents()); 
      changed = true;
    });
  }

  $root.find('p').each((_, el) => {
    const $el = $(el);
    const decoded = he.decode($el.html() || '').trim();
    if (!decoded) {
      if (el.prev && el.prev.type === 'text' && !el.prev.data.trim()) {
        el.prev.data = '';
      }
      if (el.next && el.next.type === 'text' && !el.next.data.trim()) {
        el.next.data = '';
      }
      $el.remove();
    }
  });

  // download and update src
  // also ripping of attributes that are not title or alt
  // also updating the anchor wrapper href of the img
  const images = $root.find('img[src]');
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    let originalSrc = img.attribs.srcset || img.attribs.src;

    if (originalSrc && originalSrc.includes(' ')) {
      originalSrc = originalSrc.split(' ')[0];
    }
    if (!originalSrc || !originalSrc.startsWith('http')) {
      continue;
    }
    
    if (!originalSrc.startsWith('http')) {
      continue;
    }
    try {
      const urlParts = originalSrc.split('/');
      const filename = urlParts[urlParts.length - 1];
      const newFilename = `${currentPageSlug}-inline-${filename}`;
      const localPath = path.join(__dirname, 'blog', 'images', newFilename);

      console.log(`Downloading image: ${originalSrc}`);
      await downloadImage(originalSrc, localPath);
      const altText = img.attribs.alt || '';
      const titleText = img.attribs.title || '';
      img.attribs = {};

      img.attribs.src = `https://influx-site-assets.s3.us-west-2.amazonaws.com/orangecountycosmeticsurgery/blog/${newFilename}`;
      if (altText) img.attribs.alt = altText;
      if (titleText) img.attribs.title = titleText;

      const $img = $(img);
      const $parentAnchor = $img.parent('a');
      if ($parentAnchor.length) {
        $parentAnchor.attr('href', `https://influx-site-assets.s3.us-west-2.amazonaws.com/orangecountycosmeticsurgery/blog/${newFilename}`);
      }
    } catch (error) {
      console.error(`Failed to download image ${originalSrc}:`, error.message);
    }
  }
  return $root;
}

// function to swap out anchor tags
// when porting the blog, the content will have the urls of the old site
// we need to swap those out with the update urls of the new site
function swapAnchorHrefs($root, replacements) {
  const map = new Map(replacements.map(r => [r.oldurl, r.newurl]));
  $root.find('a[href]').each((_, el) => {
    const oldHref = el.attribs.href;
    if (map.has(oldHref)) {
      el.attribs.href = map.get(oldHref);
    }
  });
  return $root;
}

// Secret Agent Shit
// wearching the page, and pulling relevant data from the page
// we need the current url slug, h1, title tag, description tag, h1, date published (anything that is SEO relevant to the) 
async function scrapeBlog(url) {
  try {
      const { data: html } = await axios.get(url);
      const $ = cheerio.load(html);
      const title = $('title').text().trim();
      const metaDescription = $('meta[name="description"]').attr('content') || '';
      const articlePublishedTime = $('meta[property="article:published_time"]').attr('content') || '';
      const articleModifiedTime = $('meta[property="article:modified_time"]').attr('content') || '';
      const h1 = $('h1').first().text().trim();
      const datePublished = $('meta[itemprop="datePublished"]').attr('content') || '';
      const dateModified = $('meta[itemprop="dateModified"]').attr('content') || '';
      const blogContentElement = $('.fl-post-content').first();
      const currentPageSlug = url.split('/').filter(Boolean).pop();
      let blogContent = ''; 
      
      // run the blog content through this cleaning thing to sanitize the data first
      if (blogContentElement.length) {
        // swapping old urls with new urls, and removing junk from the html
        swapAnchorHrefs(blogContentElement, blogUrlsSwap);
        await cleanBlogContent($, blogContentElement, currentPageSlug);
        // right before declaring the content, decode all entity codes just want plain text
        blogContent = he.decode($.html(blogContentElement));
      }

      // process categories and tags
      // really dont need this, but gathering a list of the categories and tags just in case client wanted to add that
      const catsTagsElement = $('.fl-post-cats-tags').first();
      let postedIn = '';
      let tagged = '';
      if (catsTagsElement.length) {
        const children = catsTagsElement.contents();
        let inCategory = false;
        let inTag = false;
        const categories = [];
        const tags = [];
        children.each((i, el) => {
          if (el.type === 'text') {
            const text = $(el).text().trim().toLowerCase();
            if (text.includes('posted in')) inCategory = true;
            if (text.includes('and tagged')) {
              inCategory = false;
              inTag = true;
            }
          } else if (el.tagName === 'a') {
            const text = $(el).text().trim();
            if (inCategory) categories.push(text);
            if (inTag) tags.push(text);
          }
        });
        postedIn = categories.join(', ');
        tagged = tags.join(', ');
      }

      // most blogs have a next and previous blog button at the bottom of the page. 
      // we want to grab the href & the href innerhtml
      const postNavElement = $('.fl-post-nav').first();
      swapAnchorHrefs(postNavElement, blogUrlsSwap);
      let postPrev = '';
      let postNext = '';
      if (postNavElement.length) {
        const prevAnchor = postNavElement.find('.fl-post-nav-prev a').first();
        const nextAnchor = postNavElement.find('.fl-post-nav-next a').first();
        
        if (prevAnchor.length) {
          let prevText = prevAnchor.text().trim();
          // There is some junk in the anchor text so need to rip that out
          prevText = prevText.replace(/^←\s*/, '').replace(/\s*→$/, '');
          postPrev = `href: ${prevAnchor.attr('href')}\ninnerhtml: ${prevText}`;
        }

        if (nextAnchor.length) {
          let nextText = nextAnchor.text().trim();
          // There is some junk in the anchor text so need to rip that out
          nextText = nextText.replace(/^←\s*/, '').replace(/\s*→$/, '');
          postNext = `href: ${nextAnchor.attr('href')}\ninnerhtml: ${nextText}`;
        }
      }

      return {
        url,
        title,
        metaDescription,
        articlePublishedTime,
        articleModifiedTime,
        h1,
        datePublished,
        dateModified,
        blogContent,
        postedIn,
        tagged,
        postPrev,
        postNext
      };

  } catch (error) {
    console.error(`Error scraping ${url}:`, error.message);
    return null;
  }
}

// iterating through each blog url to first scrape the info, process the info, then write the info to files
(async () => {
  for (const url of blogUrls) {
    const scrapedData = await scrapeBlog(url);
    if (!scrapedData) continue;

    const urlSlug = url.split('/').filter(Boolean).pop();
    const blogFolder = path.join(outputDir, urlSlug);
    if (!fs.existsSync(blogFolder)) {
      fs.mkdirSync(blogFolder, { recursive: true });
    }

    // dont write blank content to pages
    function writeFileIfContent(filePath, content) {
      if (content && content.trim() !== '') {
        fs.writeFileSync(filePath, content, 'utf8');
      }
    }

    // yay we made it to the end, lets get out of here
    writeFileIfContent(path.join(blogFolder, 'titletag.txt'), scrapedData.title);
    writeFileIfContent(path.join(blogFolder, 'desc.txt'), scrapedData.metaDescription);
    writeFileIfContent(path.join(blogFolder, 'published.txt'), scrapedData.articlePublishedTime);
    writeFileIfContent(path.join(blogFolder, 'articleModifiedTime.txt'), scrapedData.articleModifiedTime);
    writeFileIfContent(path.join(blogFolder, 'h1.txt'), scrapedData.h1);
    writeFileIfContent(path.join(blogFolder, 'datePublished.txt'), scrapedData.datePublished);
    writeFileIfContent(path.join(blogFolder, 'dateModified.txt'), scrapedData.dateModified);
    writeFileIfContent(path.join(blogFolder, 'index.html'), scrapedData.blogContent);
    writeFileIfContent(path.join(blogFolder, 'posts.txt'), scrapedData.postedIn);
    writeFileIfContent(path.join(blogFolder, 'tagged.txt'), scrapedData.tagged);
    writeFileIfContent(path.join(blogFolder, 'postprev.txt'), scrapedData.postPrev);
    writeFileIfContent(path.join(blogFolder, 'postnext.txt'), scrapedData.postNext);
    console.log(`Scraped and saved: ${urlSlug}`);
  }
})();