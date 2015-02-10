#!/bin/bash

# Depends: npm install -g jsdoc
DOC=doc
rm -rf $DOC
jsdoc --private -d $DOC data/contentscripts/api.js
cp -r -u $DOC/* ../fathom.web/api/
