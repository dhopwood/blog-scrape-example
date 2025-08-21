-This blog scraper was created for a specific client. 
-The same steps and processes can be used for other blogs as well with minor modifications. 

The Current Blog Data Syntax:

BLOG FORMAT UPDATE
-------------------------------------------------
Upload folders should be in the same structure as on the site.
The following files are needed for each blog post:
index.html (the html of the post)
masthead-para.html (optional - paragraph in the masthead)
published.txt (defaults to today - date published using YYYY-MM-DD)
titletag.txt (the SEO title tag)
desc.txt (the SEO description)
h1.txt (the h1 of the page)
masthead[.jpg, .png, etc.] (the masthead of the page)
postprev.txt (optional - button text & href to previous post)
postnext.txt (optional - button text & href to next post)
For postprev.txt & postnext.txt, the format should be:
href: /blog/my-post/
text: My Post Title
Any images should also be uploaded, with their src changed in the html beforehand to match the S3 Bucket location. For example: src="/images/my-image.jpg" should be changed to src="{ cms domain }{ site domain }/blog/my-image.jpg"
IMPORTANT: the html uploaded here can only include html tags needed for the blog (p, a, img, h2, h3, etc). Extra tags will be flagged and will need to be removed before upload. Spans can be added using the [.my-class][] syntax.