#include <iostream>
#include <map>
#include <opencv2/opencv.hpp>
using namespace std;
using namespace cv;

#define SPACE   0
#define BAR     255

#define Ob_(x)  (x & 1 | x >> 2 & 2 | x >> 4 & 4 | x >> 6 & 8 | x >> 8 & 16 | x >> 10 & 32 | x >> 12 & 64 | x >> 14 & 128)
#define BINARY(x)   ((unsigned)Ob_(0 ## x ## uL))

typedef cv::Mat_<uchar> Mat_uc;

typedef std::map<unsigned, char> pattern_map;
 
void setup_map(pattern_map& table)
{
    table.insert( std::make_pair( BINARY( 0001101 ), 0 ) );
    table.insert( std::make_pair( BINARY( 0011001 ), 1 ) );
    table.insert( std::make_pair( BINARY( 0010011 ), 2 ) );
    table.insert( std::make_pair( BINARY( 0111101 ), 3 ) );
    table.insert( std::make_pair( BINARY( 0100011 ), 4 ) );
    table.insert( std::make_pair( BINARY( 0110001 ), 5 ) );
    table.insert( std::make_pair( BINARY( 0101111 ), 6 ) );
    table.insert( std::make_pair( BINARY( 0111011 ), 7 ) );
    table.insert( std::make_pair( BINARY( 0110111 ), 8 ) );
    table.insert( std::make_pair( BINARY( 0001011 ), 9 ) );
}

// Left-digits always end with a 1-bit and we always begin with a 0-bit,
//  therefore if after reading a digit we are still on a bar, we need to advance our scan pointer until we reach
//  the beginning of the next digit.
//  Also, if the previous bit is 0 (SPACE), we have gone too far and we need to decrease our scan pointer in order to be
//  perfectly on the boundary between the two digits.
//  The situation is reversed for right-digits.
void align_boundary(const Mat_uc& img, cv::Point& cur, int beginVal, int endVal)
{
    if (img(cur) == endVal)
    {
        while (img(cur) == endVal)
        {
            if( (cur.x + 1) < img.size().width )
            {
                ++cur.x;
            }
            else
            {
                break;
            }
        }
    }
    else
    {
        while (img(cur.y, cur.x - 1) == beginVal)
        {
            if( cur.x > 0 )
            {
                --cur.x;
            }
            else
            {
                break;
            }
        }
    }
}

enum position
{
    LEFT,
    RIGHT
};

int read_digit( const Mat_uc&   img,
                cv::Point&      cur,
                int             unit_width,
                pattern_map&    table,
                int             position)
{
    // Read the 7 consecutive bits.
    int pattern[7] = {0, 0, 0, 0, 0, 0, 0};
    for (int i = 0; i < 7; ++i)
    {
        for (int j = 0; j < unit_width; ++j)
        {
            if (img(cur) == BAR)
            {
                ++pattern[i];
            }

            if( (cur.x + 1) < img.size().width )
            {
                ++cur.x;
            }
        }
        // See below for explanation.
        if (   pattern[i] == 1 && img(cur) == BAR
            || pattern[i] == unit_width - 1 && img(cur) == SPACE )
        {
            if( cur.x > 0 )
            {
                --cur.x;
            }
        }
    }

    // Convert to binary, consider that a bit is set if the number of
    // bars encountered is greater than a threshold.
    int threshold = unit_width / 2;
    unsigned v = 0;
    for (int i = 0; i < 7; ++i)
        v = (v << 1) + (pattern[i] >= threshold);

    // Lookup digit value.
    char digit;
    if (position == LEFT)
    {
        digit = table[v];
        align_boundary(img, cur, SPACE, BAR);
    }
    else
    {
        // Bitwise complement (only on the first 7 bits).
        digit = table[~v & BINARY(1111111)];
        align_boundary(img, cur, BAR, SPACE);
    }

    return digit;
}

bool find_quiet_zone(const Mat_uc& img, cv::Point& cur)
{
//#if defined(_DEBUG)
//    cout << "find_quiet_zone[ENTRY]: img(cur) = " << (int)img(cur) << ", cur.x " << cur.x << std::endl;
//#endif

    while( true )
    {
        if( ( cur.x + 9 ) >= img.size().width )
        {
#if defined(_DEBUG)
            cout << "find_quiet_zone: failed to find quiet zone. cur.y = " << cur.y << std::endl;
#endif
            return false;
        }

        cv::Point cur1(cur.x + 1, cur.y);
        cv::Point cur2(cur.x + 2, cur.y);
        cv::Point cur3(cur.x + 3, cur.y);
        cv::Point cur4(cur.x + 4, cur.y);
        cv::Point cur5(cur.x + 5, cur.y);
        cv::Point cur6(cur.x + 6, cur.y);
        cv::Point cur7(cur.x + 7, cur.y);
        cv::Point cur8(cur.x + 8, cur.y);
        cv::Point cur9(cur.x + 9, cur.y);

        if(    img(cur)  == SPACE
            && img(cur1) == SPACE
            && img(cur2) == SPACE
            && img(cur3) == SPACE
            && img(cur4) == SPACE
            && img(cur5) == SPACE
            && img(cur6) == SPACE
            && img(cur7) == SPACE
            && img(cur8) == SPACE
            && img(cur9) == SPACE
          )
        {
#if defined(_DEBUG)
            cout << "find_quiet_zone: FOUND @ img(cur) = " << (int)img(cur) << ", cur.x = " << cur.x << ", cur.y = " << cur.y << std::endl;
#endif
            return true;
        }

        ++cur.x;

//#if defined(_DEBUG)
//        cout << "find_quiet_zone: img(cur) = " << (int)img(cur) << ", INCR cur.x " << cur.x << std::endl;
//#endif
    }
}

int skip_quiet_zone(const Mat_uc& img, cv::Point& cur)
{
//#if defined(_DEBUG)
//    cout << "skip_quiet_zone[ENTRY]: img(cur) = " << (int)img(cur) << ", cur.x " << cur.x << std::endl;
//#endif

    while (img(cur) == SPACE)
    {
        ++cur.x;
        
        if( cur.x >= img.size().width )
        {
#if defined(_DEBUG)
            cout << "skip_quiet_zone: failure (reached EOL)" << std::endl;
#endif
            return -1;
        }

//#if defined(_DEBUG)
//        cout << "skip_quiet_zone: img(cur) = " << (int)img(cur) << ", INCR cur.x " << cur.x << std::endl;
//#endif
    }
#if defined(_DEBUG)
    cout << "skip_quiet_zone:DONE: img(cur) = " << (int)img(cur) << ", INCR cur.x " << cur.x << std::endl;
#endif

    return 0;
}

void dump_line(const Mat_uc& img, cv::Point& cur)
{
    cv::Point curLine(cur);

    cout << "dump_line:";

    while ( curLine.x < img.size().width )
    {
        cout << " " << (int)img(curLine);
        ++curLine.x;
    }

    cout << std::endl;
}

unsigned read_lguard(const Mat_uc& img, cv::Point& cur)
{
    int widths[ 3 ]   = { 0, 0, 0 };
    int pattern[ 3 ]  = { BAR, SPACE, BAR };

#if defined(_DEBUG)
     cout << "read_lguard[ENTRY]: cur.x " << cur.x << std::endl;
#endif
    for ( int i = 0; i < 3; ++i )
    {
        while (img(cur) == pattern[i])
        {
            ++cur.x;

            if( cur.x >= img.size().width )
            {
                //failed to find lguard
                return -1;
            }

            ++widths[i];

//#if defined(_DEBUG)
//            cout << "read_lguard[i=" << i << "]: incr cur.x " << cur.x << ", widths[i]=" << widths[i] << std::endl;
//#endif
        }
    }

#if defined(_DEBUG)
    cout << "read_lguard: returning " << widths[0] << std::endl;
#endif
    return widths[0];
}

int skip_mguard(const Mat_uc& img, cv::Point& cur)
{
    int pattern[5] = { SPACE, BAR, SPACE, BAR, SPACE };
    
    for (int i = 0; i < 5; ++i)
    {
        while (img(cur) == pattern[i])
        {
            ++cur.x;

            if( cur.x >= img.size().width )
            {
                return -1;
            }
        }
    }

    return 0;
}

bool scan_for_code(const Mat_uc& img, cv::Point& cur)
{
    bool matchFound( false );

    if( find_quiet_zone(img, cur) )
    {
        if( 0 == skip_quiet_zone(img, cur) )
        {
            pattern_map table;
            setup_map(table);

            int unit_width = read_lguard(img, cur);

            // check for reasonable values
            if( unit_width >= 0 && unit_width <= 10 )
            {
                std::vector<int> digits;
                std::vector<int> digits_match;

                digits_match.resize(12);
                digits_match[0] = 7;
                digits_match[1] = 3;
                digits_match[2] = 4;
                digits_match[3] = 3;
                digits_match[4] = 4;
                digits_match[5] = 3;
                digits_match[6] = 5;
                digits_match[7] = 2;
                digits_match[8] = 5;
                digits_match[9] = 2;
                digits_match[10] = 5;
                digits_match[11] = 7;

                for (int i = 0; i < 6; ++i)
                {
                    int d = read_digit(img, cur, unit_width, table, LEFT);
                    digits.push_back(d);
                }

                if( 0 == skip_mguard(img, cur) )
                {
                    for (int i = 0; i < 6; ++i)
                    {
                        int d = read_digit(img, cur, unit_width, table, RIGHT);
                        digits.push_back(d);
                    }

                    for (int i = 0; i < 12; ++i)
                    {
                        std::cout << digits[i];
                    }

                    if( digits_match == digits )
                    {
                        matchFound = true;
                        std::cout << std::endl << "MATCH!";
                    }
                    else
                    {
                        std::cout << std::endl << "no match";
                    }
                }
                else
                {
                    std::cout << "failed to decode barcode (middle guard failure)";
                }
            }
            else
            {
                std::cout << "failed to decode barcode";
            }
        }
        else
        {
            std::cout << "failed to find barcode (skip quiet zone)";
        }
    }
    else
    {
        std::cout << "failed to find barcode (find quiet zone)";
    }

    std::cout << std::endl;

    return matchFound;
}

int main( int argc, char **argv )
{
    Mat_uc img;

    if ( argc < 2 )
    {
        cout << "Usage: " << argv[0] << " <input.jpg>\n";
        exit( EXIT_FAILURE );
    }

    img = cv::imread( argv[1], 0 );

#if defined(_DEBUG)
    cout << "Read File: " << argv[1] << ", " << img.size().width << " x " << img.size().height << std::endl;
#endif

#if 0
    imwrite("barcode_input.png", img);
#endif

#if 0
    Mat edges;
    int ratio(3);
    double lowThreshold = argc >= 3 ? atoi(argv[2]) : 15,
           highThreshold = lowThreshold * ratio;

    Canny( img, edges, lowThreshold, highThreshold, 3 );
    imwrite( "barcode_edge.png", edges );
#endif

    cv::Size size = img.size();

    cv::bitwise_not(img, img);
    cv::threshold(img, img, 128, 255, cv::THRESH_BINARY);

#if 0
    cv::Point curLine(0, size.height / 2);
    dump_line( img, curLine );

    cv::Point curLine2(0, size.height * 2 / 3);
    dump_line( img, curLine2 );
    //return 0;
#endif

    for( int w = 0; w < size.width; ++w)
    {
        for( int h  = size.height / 2; h < size.height; ++h )
        {
            cv::Point cur(w, h);
            if( scan_for_code( img, cur ) )
            {
                return 0;
            }
        }

        for( int h = size.height / 2 - 1; h >= 0; --h )
        {
            cv::Point cur(w, h);
            if( scan_for_code( img, cur ) )
            {
                return 0;
            }
        }
    }
}
